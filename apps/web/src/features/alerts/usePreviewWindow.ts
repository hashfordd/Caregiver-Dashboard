import { useQuery } from '@tanstack/react-query';
import type { EventRow, PositionEstimateRow, SensorReadingRow } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HARD_ROW_CAP = 10_000; // sanity cap; far above what the preview needs

export interface PreviewWindow {
  sensors: SensorReadingRow[];
  positions: PositionEstimateRow[];
  events: EventRow[];
  /** ISO. The 'now' anchor used to compute the start of the 24 h window;
   *  passed into the inactivity 'tick' datapoint by RulePreview. */
  now: string;
}

/** Loads the last 24 h of sensor_readings, position_estimates, and events
 *  for the patient. Used by F11's RulePreview to dry-run the evaluator
 *  against historical data without writing to the alerts table. */
export function usePreviewWindow(patientId: string | undefined) {
  return useQuery({
    queryKey: ['alert-rule-preview-window', patientId],
    enabled: !!patientId,
    staleTime: 60_000,
    queryFn: async (): Promise<PreviewWindow> => {
      const now = new Date();
      const since = new Date(now.getTime() - WINDOW_MS).toISOString();
      const [sensorsRes, positionsRes, eventsRes] = await Promise.all([
        supabase
          .from('sensor_readings')
          .select(
            'id, patient_id, device_id, recorded_at, hr_bpm, spo2_pct, temp_c, accel, gyro, created_at',
          )
          .eq('patient_id', patientId!)
          .gte('recorded_at', since)
          .order('recorded_at', { ascending: false })
          .limit(HARD_ROW_CAP),
        supabase
          .from('position_estimates')
          .select(
            'id, patient_id, recorded_at, mode, x_canvas, y_canvas, lat, lng, confidence, indoor_confidence, gps_strong, created_at',
          )
          .eq('patient_id', patientId!)
          .gte('recorded_at', since)
          .order('recorded_at', { ascending: false })
          .limit(HARD_ROW_CAP),
        supabase
          .from('events')
          .select('id, patient_id, device_id, occurred_at, type, payload, created_at')
          .eq('patient_id', patientId!)
          .gte('occurred_at', since)
          .order('occurred_at', { ascending: false })
          .limit(HARD_ROW_CAP),
      ]);
      if (sensorsRes.error) throw sensorsRes.error;
      if (positionsRes.error) throw positionsRes.error;
      if (eventsRes.error) throw eventsRes.error;
      return {
        sensors: (sensorsRes.data ?? []) as SensorReadingRow[],
        positions: (positionsRes.data ?? []) as PositionEstimateRow[],
        events: (eventsRes.data ?? []) as EventRow[],
        now: now.toISOString(),
      };
    },
  });
}
