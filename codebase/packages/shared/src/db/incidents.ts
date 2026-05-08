import { z } from 'zod';

export const IncidentType = z.enum([
  'fall',
  'agitation',
  'refusal',
  'wander',
  'medication_event',
  'other',
]);
export type IncidentType = z.infer<typeof IncidentType>;

export const Incident = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  logged_by: z.string().uuid().nullable(),
  occurred_at: z.string().datetime(),
  type: IncidentType,
  severity: z.number().int().min(1).max(3),
  description: z.string(),
  follow_up_required: z.boolean(),
  resolved_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  // PostgREST embed for caregiver display name
  author: z.object({ full_name: z.string().nullable() }).nullable().optional(),
});
export type Incident = z.infer<typeof Incident>;

export const LogIncidentInput = z.object({
  type: IncidentType,
  severity: z.number().int().min(1).max(3),
  description: z.string().trim().min(1, 'Required').max(2000),
  occurred_at: z.string().datetime().optional(),
  follow_up_required: z.boolean().default(false),
});
export type LogIncidentInput = z.infer<typeof LogIncidentInput>;
