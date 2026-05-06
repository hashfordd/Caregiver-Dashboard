import { z } from 'zod';

// Mirrors public.events from the F11 migration. The bridge persists
// every validated EventMessage here (fall, button_press, low_battery,
// connect, disconnect, enrollment); the rules engine reads `type='fall'`
// rows for the fall rule type. Operational events (connect/disconnect)
// live alongside so a future device-health view can read one source.

export const EventRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  device_id: z.string().uuid().nullable(),
  occurred_at: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type EventRow = z.infer<typeof EventRow>;
