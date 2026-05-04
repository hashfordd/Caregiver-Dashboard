import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';

type SubscribeCb = (status: string, err?: Error) => void;
type OnCb = (payload: { new: unknown }) => void;

interface ChannelState {
  name: string;
  subscribeCb: SubscribeCb | null;
  ons: Map<string, OnCb>;
}

const { channels, channelMock, removeChannelMock } = vi.hoisted(() => {
  const channels = new Map<string, ChannelState>();
  const channelMock = vi.fn((name: string) => {
    const state: ChannelState = { name, subscribeCb: null, ons: new Map() };
    channels.set(name, state);
    const channel: {
      on: (event: string, opts: { table: string }, cb: OnCb) => typeof channel;
      subscribe: (cb: SubscribeCb) => typeof channel;
    } = {
      on: vi.fn((_event, opts, cb) => {
        state.ons.set(opts.table, cb);
        return channel;
      }),
      subscribe: vi.fn((cb) => {
        state.subscribeCb = cb;
        return channel;
      }),
    };
    return channel;
  });
  const removeChannelMock = vi.fn();
  return { channels, channelMock, removeChannelMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { channel: channelMock, removeChannel: removeChannelMock },
}));

import {
  PatientStreamProvider,
  usePatientStreamContext,
} from '@/features/patients/PatientStreamContext';
import type { SensorReadingRow } from '@/lib/usePatientStream';

function SensorListener({ onRow }: { onRow: (r: SensorReadingRow) => void }) {
  const { onSensorReading } = usePatientStreamContext();
  useEffect(() => onSensorReading(onRow), [onSensorReading, onRow]);
  return null;
}

beforeEach(() => {
  channels.clear();
  channelMock.mockClear();
  removeChannelMock.mockClear();
});

describe('PatientStreamProvider', () => {
  it('subscribes to the patient channel exactly once', () => {
    render(
      <PatientStreamProvider patientId="p1">
        <SensorListener onRow={() => {}} />
        <SensorListener onRow={() => {}} />
      </PatientStreamProvider>,
    );
    expect(channelMock).toHaveBeenCalledTimes(1);
    expect(channelMock).toHaveBeenCalledWith('patient:p1');
  });

  it('fans a single received row out to multiple registered listeners', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    render(
      <PatientStreamProvider patientId="p1">
        <SensorListener onRow={cbA} />
        <SensorListener onRow={cbB} />
      </PatientStreamProvider>,
    );

    const state = channels.get('patient:p1')!;
    act(() =>
      state.ons.get('sensor_readings')!({
        new: { id: 'sr-1' } as unknown as SensorReadingRow,
      }),
    );

    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('stops dispatching to a child after it unmounts; siblings keep working', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    const { rerender } = render(
      <PatientStreamProvider patientId="p1">
        <SensorListener onRow={cbA} />
        <SensorListener onRow={cbB} />
      </PatientStreamProvider>,
    );

    rerender(
      <PatientStreamProvider patientId="p1">
        <SensorListener onRow={cbB} />
      </PatientStreamProvider>,
    );

    const state = channels.get('patient:p1')!;
    act(() =>
      state.ons.get('sensor_readings')!({
        new: { id: 'sr-2' } as unknown as SensorReadingRow,
      }),
    );

    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('removes the channel when the provider unmounts', () => {
    const { unmount } = render(
      <PatientStreamProvider patientId="p1">
        <div />
      </PatientStreamProvider>,
    );
    expect(removeChannelMock).not.toHaveBeenCalled();
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });
});
