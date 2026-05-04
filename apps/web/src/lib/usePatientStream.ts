import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Realtime subscription for a single patient. Subscribes to INSERTs on
 * sensor_readings + position_estimates and to all changes on alerts, scoped
 * by patient_id. Caller supplies typed callbacks; the hook handles teardown
 * on unmount or patient change.
 *
 * TODO: F2/F3 — once DB row schemas live in @alzcare/shared, replace the
 * inline Row interfaces below with imports so this is typed end-to-end.
 */
export interface SensorReadingRow {
  id: string;
  patient_id: string;
  device_id: string;
  recorded_at: string;
  hr_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
  accel: unknown | null;
  gyro: unknown | null;
  created_at: string;
}

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

export function usePatientStream(
  patientId: string | null,
  callbacks: PatientStreamCallbacks,
): void {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!patientId) return;

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
        (payload) => callbacksRef.current.onSensorReading?.(payload.new as SensorReadingRow),
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'position_estimates',
          filter: `patient_id=eq.${patientId}`,
        },
        (payload) => callbacksRef.current.onPositionEstimate?.(payload.new as PositionEstimateRow),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `patient_id=eq.${patientId}`,
        },
        (payload) => callbacksRef.current.onAlert?.(payload.new as AlertRow),
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          callbacksRef.current.onError?.(err);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [patientId]);
}
