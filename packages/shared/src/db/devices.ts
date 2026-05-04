import { z } from 'zod';

export const Device = z.object({
  id: z.string().uuid(),
  mac_address: z.string().min(1),
  firmware_version: z.string().nullable(),
  label: z.string().nullable(),
  paired_patient_id: z.string().uuid().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
});
export type Device = z.infer<typeof Device>;

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const PairDeviceInput = z.object({
  mac_address: z.string().regex(MAC_RE, 'expected MAC like aa:bb:cc:dd:ee:ff'),
  patient_id: z.string().uuid(),
  label: z.string().max(60).optional(),
});
export type PairDeviceInput = z.infer<typeof PairDeviceInput>;
