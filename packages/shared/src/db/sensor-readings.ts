import { z } from 'zod';

// Mirrors the row shape produced by the foundation migration's
// public.sensor_readings table. Used as the realtime payload type on the
// dashboard and as the expected shape for the mqtt_bridge insert.
export const SensorReadingRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  device_id: z.string().uuid(),
  recorded_at: z.string(),
  hr_bpm: z.number().nullable(),
  spo2_pct: z.number().nullable(),
  temp_c: z.number().nullable(),
  accel: z.unknown().nullable(),
  gyro: z.unknown().nullable(),
  created_at: z.string(),
});
export type SensorReadingRow = z.infer<typeof SensorReadingRow>;

// Insert-shape — id and created_at are server-side defaults.
export interface SensorReadingInsert {
  patient_id: string;
  device_id: string;
  recorded_at: string;
  hr_bpm?: number | null;
  spo2_pct?: number | null;
  temp_c?: number | null;
  accel?: unknown | null;
  gyro?: unknown | null;
}
