import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { SensorReadingRow } from '@alzcare/shared';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import { supabase } from '@/lib/supabase';

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

export type PatientStreamStatus = 'idle' | 'subscribed' | 'disconnected' | 'error';

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

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 6;

export function usePatientStream(
  patientId: string | null,
  callbacks: PatientStreamCallbacks,
): PatientStreamHandle {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const [status, setStatus] = useState<PatientStreamStatus>('idle');
  const [lastSeen, setLastSeen] = useState<PatientStreamLastSeen>(INITIAL_LAST_SEEN);

  useEffect(() => {
    if (!patientId) {
      setStatus('idle');
      setLastSeen(INITIAL_LAST_SEEN);
      return;
    }

    let cancelled = false;
    let activeChannel: RealtimeChannel | null = null;
    let signalsChannel: RealtimeChannel | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function clearReconnect(): void {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect(reason: PatientStreamStatus): void {
      if (cancelled) return;
      if (attempt >= RECONNECT_MAX_ATTEMPTS) {
        // Give up and stay in error state — caregivers should reload
        // the page if they want to retry beyond the bounded window.
        setStatus(reason);
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      clearReconnect();
      reconnectTimer = setTimeout(() => {
        if (cancelled) return;
        // Tear down any stale channel first, then re-open.
        if (activeChannel) {
          void supabase.removeChannel(activeChannel);
          activeChannel = null;
        }
        openPostgresChannel();
      }, delay);
    }

    function openPostgresChannel(): void {
      const channel: RealtimeChannel = supabase
        .channel(`patient:${patientId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sensor_readings',
            filter: `patient_id=eq.${patientId}`,
          },
          (payload) => {
            setLastSeen((prev) => ({ ...prev, sensor: Date.now() }));
            callbacksRef.current.onSensorReading?.(payload.new as SensorReadingRow);
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'position_estimates',
            filter: `patient_id=eq.${patientId}`,
          },
          (payload) => {
            setLastSeen((prev) => ({ ...prev, position: Date.now() }));
            callbacksRef.current.onPositionEstimate?.(payload.new as PositionEstimateRow);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'alerts',
            filter: `patient_id=eq.${patientId}`,
          },
          (payload) => {
            setLastSeen((prev) => ({ ...prev, alert: Date.now() }));
            callbacksRef.current.onAlert?.(payload.new as AlertRow);
          },
        )
        .subscribe((subStatus, err) => {
          if (cancelled) return;
          if (subStatus === 'SUBSCRIBED') {
            attempt = 0; // reset backoff on a clean reconnect
            clearReconnect();
            setStatus('subscribed');
          } else if (subStatus === 'CHANNEL_ERROR') {
            setStatus('error');
            if (err) callbacksRef.current.onError?.(err);
            scheduleReconnect('error');
          } else if (subStatus === 'CLOSED' || subStatus === 'TIMED_OUT') {
            setStatus('disconnected');
            scheduleReconnect('disconnected');
          }
        });
      activeChannel = channel;
    }

    openPostgresChannel();

    // F6 signals broadcast lives on its own channel because Supabase
    // Realtime requires postgres_changes and broadcast events on
    // separate subscriptions. Status of this channel isn't surfaced —
    // postgres-channel `status` is enough for the header pill, and
    // signals are best-effort by design.
    signalsChannel = supabase
      .channel(`patient:${patientId}:signals`)
      .on('broadcast', { event: 'signals' }, (event) => {
        const payload = (event as { payload?: unknown }).payload as SignalsMessage | undefined;
        if (!payload) return;
        setLastSeen((prev) => ({ ...prev, signals: Date.now() }));
        callbacksRef.current.onSignals?.(payload);
      })
      .subscribe();

    return () => {
      cancelled = true;
      clearReconnect();
      if (activeChannel) void supabase.removeChannel(activeChannel);
      if (signalsChannel) void supabase.removeChannel(signalsChannel);
      setStatus('idle');
    };
  }, [patientId]);

  return { status, lastSeen };
}
