// F11: shared rule contracts. The `AlertRule` discriminated union mirrors
// the `alert_rules.params` JSONB shape per `type`. Owned here so the
// rules engine, the preview, and the UI all agree on the same shape —
// drift between the engine and the preview is the failure mode the
// CROSS_CUTTING §10 parity test guards against.
//
// V1 ships four types: zone, vitals, fall, inactivity. The
// repetitive_movement enum value exists in the migration but no card or
// evaluator branch ships in V1; the BACKLOG records the deferral.

import { z } from 'zod';
import type { AlertSeverity } from '../db/alerts.ts';
import type { EventRow, PositionEstimateRow, SensorReadingRow } from '../db/index.ts';

// ─── per-rule param shapes (Zod for runtime validation in the UI) ────

const ZoneParams = z.object({
  /** Polygon in floor-plan canvas coordinates: [[x_canvas, y_canvas], ...].
   *  Closed implicitly (no need to repeat the first vertex at the end). */
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  /** 'enter' fires on entering the polygon; 'exit' fires on leaving. */
  direction: z.enum(['enter', 'exit']),
  /** Seconds the condition must hold continuously before firing. 0 = immediate. */
  dwell_seconds: z.number().int().nonnegative(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type ZoneParams = z.infer<typeof ZoneParams>;

const VitalsParams = z.object({
  metric: z.enum(['hr_bpm', 'spo2_pct', 'temp_c']),
  /** Inclusive bounds. Either may be null for a one-sided range. */
  min: z.number().nullable(),
  max: z.number().nullable(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type VitalsParams = z.infer<typeof VitalsParams>;

const FallParams = z.object({
  cooldown_seconds: z.number().int().positive().optional(),
});
export type FallParams = z.infer<typeof FallParams>;

const InactivityParams = z.object({
  inactive_minutes: z.number().int().positive(),
  /** Optional time-of-day window (caregiver-local) in HH:mm-HH:mm form;
   *  fires only when 'now' falls inside the window. */
  only_between: z.object({ from: z.string(), to: z.string() }).optional(),
  /** Canvas-pixel distance below which a position change does not count
   *  as motion. Defaults to MOTION_FLOOR_PX in evaluate.ts. */
  motion_floor_px: z.number().nonnegative().optional(),
  cooldown_seconds: z.number().int().positive().optional(),
});
export type InactivityParams = z.infer<typeof InactivityParams>;

// ─── union ────────────────────────────────────────────────────────────

interface AlertRuleBase {
  id: string;
  patient_id: string;
  severity: AlertSeverity;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoneRule extends AlertRuleBase {
  type: 'zone';
  params: ZoneParams;
}
export interface VitalsRule extends AlertRuleBase {
  type: 'vitals';
  params: VitalsParams;
}
export interface FallRule extends AlertRuleBase {
  type: 'fall';
  params: FallParams;
}
export interface InactivityRule extends AlertRuleBase {
  type: 'inactivity';
  params: InactivityParams;
}

export type AlertRule = ZoneRule | VitalsRule | FallRule | InactivityRule;
export type AlertRuleType = AlertRule['type'];

/** Zod parser keyed off the rule's `type` field. Used by the UI on save
 *  and by the rules engine when it loads rule rows from the DB
 *  (defensive — the JSONB column is untyped at the storage layer). */
export const AlertRuleParams = z.discriminatedUnion('type', [
  z.object({ type: z.literal('zone'), params: ZoneParams }),
  z.object({ type: z.literal('vitals'), params: VitalsParams }),
  z.object({ type: z.literal('fall'), params: FallParams }),
  z.object({ type: z.literal('inactivity'), params: InactivityParams }),
]);

// AlertSeverity is re-exported from db/alerts via the package barrel.

// ─── evaluator IO ─────────────────────────────────────────────────────

/** The data point that triggered the evaluation. Vitals/zone/fall fire
 *  on row INSERT; inactivity fires on a scheduled tick. */
export type DataPoint =
  | { kind: 'sensor_reading'; row: SensorReadingRow }
  | { kind: 'position_estimate'; row: PositionEstimateRow }
  | { kind: 'event'; row: EventRow }
  | { kind: 'tick'; at: string };

/** Caller-loaded history. Each rule type uses what it needs:
 *  - zone: `positions` for dwell-time confirmation.
 *  - inactivity: `positions` to find the last motion.
 *  - vitals/fall: history is unused — they're per-row stateless. */
export interface HistoryWindow {
  positions: PositionEstimateRow[];
  sensors: SensorReadingRow[];
  events: EventRow[];
}

export type EvaluatorResult =
  | { fire: true; severity: AlertSeverity; context: Record<string, unknown> }
  | { fire: false };
