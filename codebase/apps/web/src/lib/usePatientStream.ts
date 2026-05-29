import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { SensorReadingRow } from '@alzcare/shared';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import { supabase } from '@/lib/supabase';
import { subscribeWithRetry } from '@/lib/subscribeWithRetry';

export type { SensorReadingRow, SignalsMessage };

/**
 * Realtime subscription for a single patient. Subscribes to INSERTs on
 * sensor_readings + position_estimates and to all changes on alerts, scoped
 * by patient_id. Caller supplies typed callbacks; the hook handles teardown
 * on unmount or patient change.
 *
 * The hook returns a `PatientStreamHandle` exposing the current channel
 * status and per-channel `lastSeen` timestamps so the patient header can
 * surface a connection pill (subscribed/disconnected/error) and downstream
 * tabs can render stale-data warnings without each opening their own
 * subscription.
 *
 * Phase E item 40: a reconnect watchdog re-creates the postgres-changes
 * channel after a CHANNEL_ERROR / CLOSED / TIMED_OUT transition with
 * exponential backoff (5s → 10s → 20s, capped at 30s, max 6 attempts).
 * Without this, a transient WS drop during a long shift left the
 * dashboard silently disconnected — caregivers leave the tab open for
 * hours and a single hiccup would silence every alert.
 *
 * Item 91: reconnect logic extracted into subscribeWithRetry so
 * useAllocatedAlerts and any future hooks get the same watchdog.
 *
 * Perf: `lastSeen` is updated through a leading-edge throttle rather than
 * once per inbound message. Under multi-Hz telemetry × N patients a
 * per-message setState cascaded a re-render through every PatientStream
 * context consumer. The first sample in a burst applies immediately (so
 * the header pill reacts instantly and tests observe it synchronously);
 * further samples within COALESCE_MS collapse into a single trailing
 * flush. Net effect: at most ~1 lastSeen render/sec instead of one per
 * packet, with no loss of "is data flowing" fidelity.
 */

export interface PositionEstimateRow {
  id: string;
  patient_id: string;
  recorded_at: string;
  mode: 'indoor' | 'outdoor';
  x_canvas: number | null;
  y_canvas: number | null;
  lat: number | null;
  lng: number | null;
  confidence: number | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  patient_id: string;
  rule_id: string | null;
  severity: 'info' | 'warn' | 'critical';
  fired_at: string;
  acknowledged_at: string | null;
  ack_by_caregiver_id: string | null;
  context: Record<string, unknown>;
}

export interface PatientStreamCallbacks {
  onSensorReading?: (row: SensorReadingRow) => void;
  onPositionEstimate?: (row: PositionEstimateRow) => void;
  onAlert?: (row: AlertRow) => void;
  /** F6: BLE/Wi-Fi RSSI samples re-broadcast by the mqtt_bridge after
   *  validation. Signals are deliberately not persisted (Phase 2 design;
   *  see PHASES.md) so they reach the dashboard via a Supabase Realtime
   *  broadcast channel `patient:<id>:signals` instead of postgres_changes. */
  onSignals?: (msg: SignalsMessage) => void;
  onError?: (error: Error) => void;
}

export type PatientStreamStatus =
  | 'idle'
  | 'subscribed'
  | 'disconnected'
  | 'error'
  // Fast-retry budget exhausted; still retrying on the slow interval.
  | 'offline';

export interface PatientStreamLastSeen {
  sensor: number | null;
  position: number | null;
  alert: number | null;
  signals: number | null;
}

export interface PatientStreamHandle {
  status: PatientStreamStatus;
  lastSeen: PatientStreamLastSeen;
}

const INITIAL_LAST_SEEN: PatientStreamLastSeen = {
  sensor: null,
  position: null,
  alert: null,
  signals: null,
};

// Coalescing window for lastSeen flushes. Matches the 1s relative-time
// tick used by the dashboard grid — finer resolution buys nothing the UI
// can show.
const LAST_SEEN_COALESCE_MS = 1_000;

export function usePatientStream(
  patientId: string | null,
  callbacks: PatientStreamCallbacks,
): PatientStreamHandle {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const [status, setStatus] = useState<PatientStreamStatus>('idle');
  const [lastSeen, setLastSeen] = useState<PatientStreamLastSeen>(INITIAL_LAST_SEEN);

  // Leading-edge throttle plumbing for lastSeen (see header note). The
  // ref holds the authoritative value; setState only fires on the
  // leading edge of a burst and once on the trailing edge.
  const lastSeenRef = useRef<PatientStreamLastSeen>(INITIAL_LAST_SEEN);
  const lastFlushAtRef = useRef(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!patientId) {
      setStatus('idle');
      setLastSeen(INITIAL_LAST_SEEN);
      lastSeenRef.current = INITIAL_LAST_SEEN;
      lastFlushAtRef.current = 0;
      return;
    }

    let signalsChannel: RealtimeChannel | null = null;

    // Reset the throttle baseline for this patient session so the first
    // sample always applies on the leading edge.
    lastSeenRef.current = INITIAL_LAST_SEEN;
    lastFlushAtRef.current = 0;

    const bumpLastSeen = (field: keyof PatientStreamLastSeen): void => {
      lastSeenRef.current = { ...lastSeenRef.current, [field]: Date.now() };
      const elapsed = Date.now() - lastFlushAtRef.current;
      if (elapsed >= LAST_SEEN_COALESCE_MS) {
        lastFlushAtRef.current = Date.now();
        setLastSeen(lastSeenRef.current);
      } else if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          lastFlushAtRef.current = Date.now();
          setLastSeen(lastSeenRef.current);
        }, LAST_SEEN_COALESCE_MS - elapsed);
      }
    };

    const unsubscribePostgres = subscribeWithRetry({
      channelName: `patient:${patientId}`,
      postgresHandlers: [
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sensor_readings',
          filter: `patient_id=eq.${patientId}`,
          onMessage: (row) => {
            bumpLastSeen('sensor');
            callbacksRef.current.onSensorReading?.(row as SensorReadingRow);
          },
        },
        {
          event: 'INSERT',
          schema: 'public',
          table: 'position_estimates',
          filter: `patient_id=eq.${patientId}`,
          onMessage: (row) => {
            bumpLastSeen('position');
            callbacksRef.current.onPositionEstimate?.(row as PositionEstimateRow);
          },
        },
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `patient_id=eq.${patientId}`,
          onMessage: (row) => {
            bumpLastSeen('alert');
            callbacksRef.current.onAlert?.(row as AlertRow);
          },
        },
      ],
      onSubscribed: () => setStatus('subscribed'),
      onError: (err) => {
        setStatus('error');
        callbacksRef.current.onError?.(err);
      },
      onStatusChange: (s) => {
        if (s === 'CLOSED' || s === 'TIMED_OUT') setStatus('disconnected');
      },
      onOffline: () => setStatus('offline'),
    });

    // F6 signals broadcast lives on its own channel because Supabase
    // Realtime requires postgres_changes and broadcast events on
    // separate subscriptions. Status of this channel isn't surfaced —
    // postgres-channel `status` is enough for the header pill, and
    // signals are best-effort by design.
    //
    // SEC-01: opened as a *private* channel so Realtime Authorization
    // gates receipt by the realtime.messages RLS policy
    // (`can_access_patient`). A caregiver can no longer subscribe to
    // another patient's live signals by guessing the topic name.
    signalsChannel = supabase
      .channel(`patient:${patientId}:signals`, { config: { private: true } })
      .on('broadcast', { event: 'signals' }, (event) => {
        const payload = (event as { payload?: unknown }).payload as SignalsMessage | undefined;
        if (!payload) return;
        bumpLastSeen('signals');
        callbacksRef.current.onSignals?.(payload);
      })
      .subscribe();

    return () => {
      unsubscribePostgres();
      if (signalsChannel) void supabase.removeChannel(signalsChannel);
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      setStatus('idle');
    };
  }, [patientId]);

  return { status, lastSeen };
}
