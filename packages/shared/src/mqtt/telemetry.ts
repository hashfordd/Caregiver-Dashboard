import { z } from 'zod';

export const Vec3 = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3>;

export const TelemetryMessage = z.object({
  v: z.literal(1),
  patient_id: z.string().uuid(),
  device_id: z.string().min(1),
  recorded_at: z.string().datetime(),
  hr_bpm: z.number().min(0).max(300).nullable().optional(),
  spo2_pct: z.number().min(0).max(100).nullable().optional(),
  temp_c: z.number().min(20).max(45).nullable().optional(),
  accel: Vec3.nullable().optional(),
  gyro: Vec3.nullable().optional(),
  battery_pct: z.number().min(0).max(100).optional(),
  fw_version: z.string().optional(),
});
export type TelemetryMessage = z.infer<typeof TelemetryMessage>;
