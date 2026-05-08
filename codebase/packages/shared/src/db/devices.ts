import { z } from 'zod';

export const Device = z.object({
  id: z.string().uuid(),
  mac_address: z.string().min(1),
  firmware_version: z.string().nullable(),
  label: z.string().nullable(),
  paired_patient_id: z.string().uuid().nullable(),
  // Phase F item 60: timestamps now require ISO 8601 with offset to
  // match what Supabase + Postgres emit for timestamptz columns.
  last_seen_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type Device = z.infer<typeof Device>;

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const PairDeviceInput = z.object({
  mac_address: z.string().regex(MAC_RE, 'expected MAC like aa:bb:cc:dd:ee:ff'),
  patient_id: z.string().uuid(),
  label: z.string().max(60).optional(),
});
export type PairDeviceInput = z.infer<typeof PairDeviceInput>;
