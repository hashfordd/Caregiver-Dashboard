import { z } from 'zod';

export const AlertSeverity = z.enum(['info', 'warn', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

// Mirrors public.alerts from the foundation migration.
//
// Phase F item 60: timestamps tightened to ISO 8601 with offset.
export const AlertRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  rule_id: z.string().uuid().nullable(),
  severity: AlertSeverity,
  fired_at: z.string().datetime({ offset: true }),
  acknowledged_at: z.string().datetime({ offset: true }).nullable(),
  ack_by_caregiver_id: z.string().uuid().nullable(),
  context: z.record(z.string(), z.unknown()),
});
export type AlertRow = z.infer<typeof AlertRow>;
