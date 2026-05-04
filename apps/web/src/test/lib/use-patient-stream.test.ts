import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

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
    expect(removeChannelMock).not.toHaveBeenCalled();

    rerender({ id: 'p2' });
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(channelMock).toHaveBeenCalledWith('patient:p2');
  });
});
