import { z } from 'zod';
import { Vec3 } from '../mqtt/telemetry.ts';

// Mirrors the row shape produced by the foundation migration's
// public.sensor_readings table. Used as the realtime payload type on
// the dashboard and as the expected shape for the mqtt_bridge insert.
//
// Phase F item 60: accel/gyro tightened from z.unknown() to Vec3 so
// downstream consumers don't have to re-cast to read .x/.y/.z, and the
// schema rejects malformed JSONB at the Zod boundary. Timestamps use
// .datetime({ offset: true }) so PG-emitted ISO strings with timezone
// offsets round-trip cleanly.
export const SensorReadingRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  device_id: z.string().uuid(),
  recorded_at: z.string().datetime({ offset: true }),
  hr_bpm: z.number().nullable(),
  spo2_pct: z.number().nullable(),
  temp_c: z.number().nullable(),
  accel: Vec3.nullable(),
  gyro: Vec3.nullable(),
  created_at: z.string().datetime({ offset: true }),
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
  accel?: Vec3 | null;
  gyro?: Vec3 | null;
}
