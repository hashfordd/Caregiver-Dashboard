import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// Matches the watchdog constants in usePatientStream (Phase E item 40).
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 30_000;
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
}

/**
 * Generic Supabase realtime subscription helper with exponential-backoff
 * reconnection. Extracted from usePatientStream (Phase E item 40) so
 * any hook can get the same CHANNEL_ERROR / CLOSED / TIMED_OUT watchdog
 * without duplicating the retry logic.
 *
 * Returns an `unsubscribe` function that cancels any pending retry timer
 * and removes the active channel. Call it from the useEffect cleanup.
 */
export function subscribeWithRetry<T = unknown>(
  opts: SubscribeWithRetryOptions<T>,
): () => void {
  let cancelled = false;
  let activeChannel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  function clearReconnect(): void {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(reason: string): void {
    if (cancelled) return;
    if (attempt >= RECONNECT_MAX_ATTEMPTS) {
      opts.onStatusChange?.(reason);
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
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
    let ch: RealtimeChannel = supabase.channel(opts.channelName);

    for (const h of opts.postgresHandlers) {
      ch = ch.on(
        'postgres_changes',
        {
          event: h.event,
          schema: h.schema,
          table: h.table,
          ...(h.filter ? { filter: h.filter } : {}),
        },
        (payload) => {
          h.onMessage(payload.new as T);
        },
      );
    }

    ch.subscribe((subStatus, err) => {
      if (cancelled) return;
      opts.onStatusChange?.(subStatus);
      if (subStatus === 'SUBSCRIBED') {
        attempt = 0;
        clearReconnect();
        opts.onSubscribed?.();
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
  };
}
