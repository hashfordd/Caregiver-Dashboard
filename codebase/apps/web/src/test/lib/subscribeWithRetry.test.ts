import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type SubscribeCb = (status: string, err?: Error) => void;

interface ChannelState {
  name: string;
  subscribeCb: SubscribeCb | null;
}

const { channels, channelMock, removeChannelMock } = vi.hoisted(() => {
  const channels: ChannelState[] = [];
  const channelMock = vi.fn((name: string) => {
    const state: ChannelState = { name, subscribeCb: null };
    channels.push(state);
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((cb: SubscribeCb) => {
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

import { subscribeWithRetry } from '@/lib/subscribeWithRetry';
import { useRealtimeHealthStore, selectAnyOffline } from '@/lib/stores/realtimeHealthStore';

beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
  channelMock.mockClear();
  removeChannelMock.mockClear();
  useRealtimeHealthStore.setState({ channels: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Drive the most-recently-opened channel through CHANNEL_ERROR and let
 *  its backoff timer fire so the next attempt opens a fresh channel. */
function failAndAdvance(): void {
  channels[channels.length - 1]!.subscribeCb!('CHANNEL_ERROR', new Error('boom'));
  vi.runOnlyPendingTimers();
}

describe('subscribeWithRetry reliability', () => {
  it('keeps retrying forever and reports "offline" once the fast-retry budget is exhausted', () => {
    const onOffline = vi.fn();
    const unsubscribe = subscribeWithRetry({
      channelName: 'ch1',
      postgresHandlers: [],
      onOffline,
    });

    // Six fast-backoff attempts, then it crosses into "offline".
    for (let i = 0; i < 8; i += 1) failAndAdvance();

    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(selectAnyOffline(useRealtimeHealthStore.getState())).toBe(true);

    // Critically: it has NOT stopped. Each failure still opened a new
    // channel — far more than the old 6-attempt ceiling.
    expect(channelMock.mock.calls.length).toBeGreaterThan(7);

    unsubscribe();
    expect(useRealtimeHealthStore.getState().channels.ch1).toBeUndefined();
  });

  it('recovers: SUBSCRIBED after offline flips health back and fires onReconnected', () => {
    const onReconnected = vi.fn();
    subscribeWithRetry({ channelName: 'ch2', postgresHandlers: [], onReconnected });

    for (let i = 0; i < 8; i += 1) failAndAdvance();
    expect(selectAnyOffline(useRealtimeHealthStore.getState())).toBe(true);

    channels[channels.length - 1]!.subscribeCb!('SUBSCRIBED');
    expect(onReconnected).toHaveBeenCalledTimes(1);
    expect(useRealtimeHealthStore.getState().channels.ch2).toBe('subscribed');
    expect(selectAnyOffline(useRealtimeHealthStore.getState())).toBe(false);
  });
});
