import { create } from 'zustand';

/** Per-channel realtime connection health, reported automatically by
 *  subscribeWithRetry. 'offline' means the channel has exhausted its
 *  fast-retry budget and is now retrying on the slow capped interval —
 *  i.e. live data has been lost long enough that a caregiver must be
 *  told, loudly. */
export type ChannelHealth = 'connecting' | 'subscribed' | 'offline';

interface RealtimeHealthState {
  channels: Record<string, ChannelHealth>;
  report: (channel: string, health: ChannelHealth) => void;
  clear: (channel: string) => void;
}

export const useRealtimeHealthStore = create<RealtimeHealthState>((set) => ({
  channels: {},
  report: (channel, health) =>
    set((state) => {
      if (state.channels[channel] === health) return state;
      return { channels: { ...state.channels, [channel]: health } };
    }),
  clear: (channel) =>
    set((state) => {
      if (!(channel in state.channels)) return state;
      const next = { ...state.channels };
      delete next[channel];
      return { channels: next };
    }),
}));

/** True when at least one realtime channel is in the degraded "offline"
 *  state. Use as a Zustand selector: `useRealtimeHealthStore(selectAnyOffline)`. */
export function selectAnyOffline(state: RealtimeHealthState): boolean {
  for (const h of Object.values(state.channels)) {
    if (h === 'offline') return true;
  }
  return false;
}
