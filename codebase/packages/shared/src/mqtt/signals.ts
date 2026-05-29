import { z } from 'zod';

export const BleSample = z.object({
  mac: z.string().min(1),
  rssi: z.number().min(-127).max(20),
  /** Beacon battery %, when the beacon advertises it (e.g. 0x0505 manufacturer
   *  data). Optional + back-compatible: samples without it parse unchanged. */
  battery_pct: z.number().min(0).max(100).optional(),
  /** Beacon battery voltage (V), when advertised. */
  voltage: z.number().min(0).max(10).optional(),
});
export type BleSample = z.infer<typeof BleSample>;

export const WifiSample = z.object({
  bssid: z.string().min(1),
  rssi: z.number().min(-127).max(20),
  ssid: z.string().optional(),
});
export type WifiSample = z.infer<typeof WifiSample>;

export const GpsFix = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  hdop: z.number().nonnegative().optional(),
  fix_age_s: z.number().nonnegative().optional(),
});
export type GpsFix = z.infer<typeof GpsFix>;

export const SignalsMessage = z.object({
  v: z.literal(1),
  patient_id: z.string().uuid(),
  device_id: z.string().min(1),
  recorded_at: z.string().datetime(),
  ble: z.array(BleSample).default([]),
  wifi: z.array(WifiSample).default([]),
  gps: GpsFix.optional(),
});
export type SignalsMessage = z.infer<typeof SignalsMessage>;
