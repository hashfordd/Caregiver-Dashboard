import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useRealtimeHealthStore } from '@/lib/stores/realtimeHealthStore';

// Matches the watchdog constants in usePatientStream (Phase E item 40).
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 30_000;
// After this many failed attempts the channel is declared "offline" to
// the health registry (driving the loud LIVE DATA LOST banner), but it
// KEEPS retrying forever at RECONNECT_MAX_MS — see scheduleReconnect.
const RECONNECT_MAX_ATTEMPTS = 6;

type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface PostgresHandler<T = unknown> {
  event: PostgresEvent;
  schema: string;
  table: string;
  filter?: string;
  onMessage: (row: T) => void;
}

export interface SubscribeWithRetryOptions<T = unknown> {
  channelName: string;
  postgresHandlers: PostgresHandler<T>[];
  onSubscribed?: () => void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: string) => void;
  /** Fired once when the channel crosses RECONNECT_MAX_ATTEMPTS into the
   *  degraded "offline" state. The channel keeps retrying afterwards. */
  onOffline?: () => void;
  /** Fired when the channel recovers (SUBSCRIBED) after having been
   *  offline, so callers can clear any "data lost" UI. */
  onReconnected?: () => void;
}

/**
 * Generic Supabase realtime subscription helper with exponential-backoff
 * reconnection. Extracted from usePatientStream (Phase E item 40) so
 * any hook can get the same CHANNEL_ERROR / CLOSED / TIMED_OUT watchdog
 * without duplicating the retry logic.
 *
 * Reliability: the watchdog never gives up. The first RECONNECT_MAX_ATTEMPTS
 * failures back off exponentially (5s → 10s → 20s → 30s); after that the
 * channel is declared "offline" to the realtime-health registry — driving
 * the loud, blocking LIVE DATA LOST banner — and KEEPS retrying forever at
 * the 30s cap. Previously it stopped trying after 6 attempts, leaving a
 * patient-monitoring dashboard silently dead for the rest of the session.
 *
 * Every channel auto-reports its state (connecting / subscribed / offline)
 * into useRealtimeHealthStore keyed by channelName, so callers get the
 * banner for free without wiring callbacks.
 *
 * Returns an `unsubscribe` function that cancels any pending retry timer
 * and removes the active channel. Call it from the useEffect cleanup.
 */
export function subscribeWithRetry<T = unknown>(opts: SubscribeWithRetryOptions<T>): () => void {
  let cancelled = false;
  let activeChannel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let offline = false;

  const reportHealth = (state: 'connecting' | 'subscribed' | 'offline'): void => {
    // Re-read getState each call so we don't capture a stale action ref.
    useRealtimeHealthStore.getState().report(opts.channelName, state);
  };

  function clearReconnect(): void {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(reason: string): void {
    if (cancelled) return;
    opts.onStatusChange?.(reason);
    // Past the fast-retry budget: declare offline (loud banner) but keep
    // retrying forever at the capped interval. Never go silent.
    if (attempt >= RECONNECT_MAX_ATTEMPTS && !offline) {
      offline = true;
      reportHealth('offline');
      opts.onOffline?.();
    }
    // Cap the exponent so very long outages don't overflow the shift math;
    // the delay is clamped to RECONNECT_MAX_MS regardless.
    const expo = RECONNECT_BASE_MS * 2 ** Math.min(attempt, RECONNECT_MAX_ATTEMPTS);
    const delay = Math.min(expo, RECONNECT_MAX_MS);
    attempt += 1;
    clearReconnect();
    reconnectTimer = setTimeout(() => {
      if (cancelled) return;
      if (activeChannel) {
        void supabase.removeChannel(activeChannel);
        activeChannel = null;
      }
      open();
    }, delay);
  }

  function open(): void {
    if (!offline) reportHealth('connecting');
    // Cast through `any` because `RealtimeChannel.on('postgres_changes', …)`
    // is one of several overloads and TS narrows to broadcast first when
    // the predicate object has dynamic shape. The runtime contract is the
    // documented Supabase Realtime postgres_changes shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ch: RealtimeChannel = supabase.channel(opts.channelName) as any;

    for (const h of opts.postgresHandlers) {
      const filterShape: Record<string, unknown> = {
        event: h.event,
        schema: h.schema,
        table: h.table,
      };
      if (h.filter) filterShape.filter = h.filter;
      ch = (
        ch as unknown as {
          on: (
            type: 'postgres_changes',
            filter: Record<string, unknown>,
            handler: (payload: { new: unknown }) => void,
          ) => RealtimeChannel;
        }
      ).on('postgres_changes', filterShape, (payload) => {
        h.onMessage(payload.new as T);
      });
    }

    ch.subscribe((subStatus, err) => {
      if (cancelled) return;
      opts.onStatusChange?.(subStatus);
      if (subStatus === 'SUBSCRIBED') {
        const wasOffline = offline;
        attempt = 0;
        offline = false;
        clearReconnect();
        reportHealth('subscribed');
        opts.onSubscribed?.();
        if (wasOffline) opts.onReconnected?.();
      } else if (subStatus === 'CHANNEL_ERROR') {
        if (err) opts.onError?.(err);
        scheduleReconnect('error');
      } else if (subStatus === 'CLOSED' || subStatus === 'TIMED_OUT') {
        scheduleReconnect('disconnected');
      }
    });

    activeChannel = ch;
  }

  open();

  return () => {
    cancelled = true;
    clearReconnect();
    if (activeChannel) void supabase.removeChannel(activeChannel);
    useRealtimeHealthStore.getState().clear(opts.channelName);
  };
}
