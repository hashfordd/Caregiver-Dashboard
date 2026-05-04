import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { SensorReadingRow } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';

export type { SensorReadingRow };

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
 * TODO: F8/F11 — move PositionEstimateRow + AlertRow into @alzcare/shared/db
 * when their owning features ship.
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
  onError?: (error: Error) => void;
}

export type PatientStreamStatus = 'idle' | 'subscribed' | 'disconnected' | 'error';

export interface PatientStreamLastSeen {
  sensor: number | null;
  position: number | null;
  alert: number | null;
}

export interface PatientStreamHandle {
  status: PatientStreamStatus;
  lastSeen: PatientStreamLastSeen;
}

const INITIAL_LAST_SEEN: PatientStreamLastSeen = {
  sensor: null,
  position: null,
  alert: null,
};

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
        if (subStatus === 'SUBSCRIBED') {
          setStatus('subscribed');
        } else if (subStatus === 'CHANNEL_ERROR') {
          setStatus('error');
          if (err) callbacksRef.current.onError?.(err);
        } else if (subStatus === 'CLOSED' || subStatus === 'TIMED_OUT') {
          setStatus('disconnected');
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      setStatus('idle');
    };
  }, [patientId]);

  return { status, lastSeen };
}
