import { z } from 'zod';

export const EventType = z.enum([
  'fall',
  'button_press',
  'low_battery',
  'connect',
  'disconnect',
  'enrollment',
]);
export type EventType = z.infer<typeof EventType>;

export const EventMessage = z.object({
  v: z.literal(1),
  patient_id: z.string().uuid(),
  device_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  type: EventType,
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type EventMessage = z.infer<typeof EventMessage>;
