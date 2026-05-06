import { z } from 'zod';

export const AlertSeverity = z.enum(['info', 'warn', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

// Mirrors public.alerts from the foundation migration.
export const AlertRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  rule_id: z.string().uuid().nullable(),
  severity: AlertSeverity,
  fired_at: z.string(),
  acknowledged_at: z.string().nullable(),
  ack_by_caregiver_id: z.string().uuid().nullable(),
  context: z.record(z.string(), z.unknown()),
});
export type AlertRow = z.infer<typeof AlertRow>;
