import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

type SubscribeCb = (status: string, err?: Error) => void;
type OnCb = (payload: { new: unknown }) => void;
type BroadcastCb = (event: { payload?: unknown }) => void;

interface ChannelState {
  name: string;
  subscribeCb: SubscribeCb | null;
  /** Keyed by table name for postgres_changes; `__broadcast:<event>` for broadcast. */
  ons: Map<string, OnCb | BroadcastCb>;
}

const { channels, channelMock, removeChannelMock } = vi.hoisted(() => {
  const channels = new Map<string, ChannelState>();
  const channelMock = vi.fn((name: string) => {
    const state: ChannelState = { name, subscribeCb: null, ons: new Map() };
    channels.set(name, state);
    const channel: {
      on: (
        event: string,
        opts: { table?: string; event?: string },
        cb: OnCb | BroadcastCb,
      ) => typeof channel;
      subscribe: (cb?: SubscribeCb) => typeof channel;
    } = {
      on: vi.fn((event, opts, cb) => {
        if (event === 'broadcast') {
          state.ons.set(`__broadcast:${opts.event}`, cb);
        } else if (opts.table) {
          state.ons.set(opts.table, cb);
        }
        return channel;
      }),
      subscribe: vi.fn((cb) => {
        if (cb) state.subscribeCb = cb;
        return channel;
      }),
    };
    return channel;
  });
  const removeChannelMock = vi.fn();
  return { channels, channelMock, removeChannelMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
  },
}));

import { usePatientStream } from '@/lib/usePatientStream';

beforeEach(() => {
  channels.clear();
  channelMock.mockClear();
  removeChannelMock.mockClear();
});

describe('usePatientStream', () => {
  it('starts idle and transitions to subscribed on SUBSCRIBED', () => {
    const { result } = renderHook(() => usePatientStream('p1', {}));
    expect(result.current.status).toBe('idle');

    const state = channels.get('patient:p1')!;
    act(() => state.subscribeCb!('SUBSCRIBED'));
    expect(result.current.status).toBe('subscribed');
  });

  it('reports error and invokes onError on CHANNEL_ERROR', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => usePatientStream('p1', { onError }));

    const state = channels.get('patient:p1')!;
    act(() => state.subscribeCb!('CHANNEL_ERROR', new Error('boom')));
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('updates lastSeen.sensor on each sensor reading received', () => {
    const onSensorReading = vi.fn();
    const { result } = renderHook(() => usePatientStream('p1', { onSensorReading }));
    const state = channels.get('patient:p1')!;
    expect(result.current.lastSeen.sensor).toBeNull();

    const before = Date.now();
    act(() => state.ons.get('sensor_readings')!({ new: { id: 'sr-1' } }));
    expect(result.current.lastSeen.sensor).toBeGreaterThanOrEqual(before);
    expect(onSensorReading).toHaveBeenCalledWith({ id: 'sr-1' });
  });

  it('removes the previous channel before opening a new one when patientId changes', () => {
    const { rerender } = renderHook(({ id }: { id: string | null }) => usePatientStream(id, {}), {
      initialProps: { id: 'p1' as string | null },
    });
    expect(channelMock).toHaveBeenCalledWith('patient:p1');
    expect(channelMock).toHaveBeenCalledWith('patient:p1:signals');
    expect(removeChannelMock).not.toHaveBeenCalled();

    rerender({ id: 'p2' });
    // F6: BOTH the postgres-changes channel and the signals broadcast
    // channel must tear down on patient switch — leaving either
    // subscribed leaks signals from the previous patient.
    expect(removeChannelMock).toHaveBeenCalledTimes(2);
    expect(channelMock).toHaveBeenCalledWith('patient:p2');
    expect(channelMock).toHaveBeenCalledWith('patient:p2:signals');
  });

  it('opens a separate signals broadcast channel and forwards payloads via onSignals', () => {
    const onSignals = vi.fn();
    const { result } = renderHook(() => usePatientStream('p1', { onSignals }));
    expect(channelMock).toHaveBeenCalledWith('patient:p1:signals');
    const signalsState = channels.get('patient:p1:signals')!;
    const handler = signalsState.ons.get('__broadcast:signals') as BroadcastCb;
    expect(handler).toBeTypeOf('function');

    const payload = {
      v: 1,
      patient_id: 'p1',
      device_id: 'd1',
      recorded_at: '2026-05-05T00:00:00Z',
      ble: [{ mac: 'AA:BB:CC:DD:EE:01', rssi: -55 }],
      wifi: [],
    };
    const before = Date.now();
    act(() => handler({ payload }));
    expect(onSignals).toHaveBeenCalledWith(payload);
    expect(result.current.lastSeen.signals).toBeGreaterThanOrEqual(before);
  });

  it('drops broadcast events that arrive without a payload (defensive)', () => {
    const onSignals = vi.fn();
    renderHook(() => usePatientStream('p1', { onSignals }));
    const handler = channels
      .get('patient:p1:signals')!
      .ons.get('__broadcast:signals') as BroadcastCb;
    act(() => handler({}));
    expect(onSignals).not.toHaveBeenCalled();
  });
});
