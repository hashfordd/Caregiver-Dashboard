import { z } from 'zod';

// Mirrors the row shape produced by the foundation migration's
// public.position_estimates table, extended with the POS-08 hysteresis
// columns added in 20260506000100_position_estimates_hysteresis_columns.
//
// Both nullable: legacy rows from before the hysteresis migration carry
// NULL for both. The mode-decision logic treats NULL as "no information".
//
// Phase F item 60: timestamps tightened to ISO 8601 with offset to
// match Postgres emission.

export const PositionEstimateRow = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  recorded_at: z.string().datetime({ offset: true }),
  mode: z.enum(['indoor', 'outdoor']),
  x_canvas: z.number().nullable(),
  y_canvas: z.number().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  confidence: z.number().nullable(),
  indoor_confidence: z.number().nullable(),
  gps_strong: z.boolean().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type PositionEstimateRow = z.infer<typeof PositionEstimateRow>;
