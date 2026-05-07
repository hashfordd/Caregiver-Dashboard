import { z } from 'zod';
import { EventType } from '../mqtt/events.ts';

// Mirrors public.events from the F11 migration. The bridge persists
// every validated EventMessage here (fall, button_press, low_battery,
// connect, disconnect, enrollment); the rules engine reads `type='fall'`
// rows for the fall rule type. Operational events live alongside so a
// future device-health view can read one source.
//
// Phase F item 60: `type` tightened from z.string() to the EventType
// enum so the row schema matches the wire schema. Legacy rows whose
// `type` falls outside the enum will fail Zod parse at the boundary —
// surface with a console warn and skip rather than crash.

export const EventRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  device_id: z.string().uuid().nullable(),
  occurred_at: z.string().datetime({ offset: true }),
  type: EventType,
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
});
export type EventRow = z.infer<typeof EventRow>;
