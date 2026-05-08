import type { AlertSeverity } from '@alzcare/shared';

// Range presets the History tab exposes. Custom ⇒ caller supplies
// explicit ISO timestamps; everything else is computed from "now"
// at fetch time so the data follows the wall clock as it advances.
export type RangePreset = '1h' | '6h' | '24h' | '7d' | 'custom';

export interface DateRange {
  preset: RangePreset;
  /** Inclusive lower bound (ISO 8601 UTC). For non-custom presets the
   *  hooks compute this from the preset + `now`; for `custom` the
   *  caller fills it in. Stored on the range so the cache key is
   *  stable across renders that didn't change the selection. */
  from: string;
  to: string;
}

export type AlertRuleType = 'zone' | 'vitals' | 'fall' | 'inactivity' | 'repetitive_movement';

export interface AlertHistoryFilters {
  severities: Set<AlertSeverity>;
  ruleTypes: Set<AlertRuleType>;
}

/** Alert row joined with `alert_rules.type`. The base `alerts` table
 *  doesn't carry rule type directly — it lives on the rule the alert
 *  was fired by. Filtering by rule type therefore needs the join. */
export interface AlertHistoryRow {
  id: string;
  patient_id: string;
  rule_id: string | null;
  /** Null when the rule has been deleted (alert kept on `set null`). */
  rule_type: AlertRuleType | null;
  severity: AlertSeverity;
  fired_at: string;
  acknowledged_at: string | null;
  ack_by_caregiver_id: string | null;
  context: Record<string, unknown>;
}

export interface VitalsHistoryRow {
  recorded_at: string;
  hr_bpm: number | null;
  spo2_pct: number | null;
  temp_c: number | null;
}

/** Subset of `position_estimates` columns we need for replay + CSV. */
export interface PositionHistoryRow {
  recorded_at: string;
  mode: 'indoor' | 'outdoor';
  x_canvas: number | null;
  y_canvas: number | null;
  lat: number | null;
  lng: number | null;
  confidence: number | null;
}

/** Compute (from, to) for a non-custom preset, anchored to `nowMs`.
 *  Pure helper so the queries hook + tests can share it. The custom
 *  preset is opaque to this helper — callers manage from/to directly. */
export function computeRange(
  preset: Exclude<RangePreset, 'custom'>,
  nowMs: number,
): { from: string; to: string } {
  const to = new Date(nowMs).toISOString();
  const from = new Date(nowMs - PRESET_TO_MS[preset]).toISOString();
  return { from, to };
}

const PRESET_TO_MS: Record<Exclude<RangePreset, 'custom'>, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
