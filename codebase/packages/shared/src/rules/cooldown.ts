// F11: cooldown helpers. Single source per CROSS_CUTTING §3 — both the
// live engine and the preview consume these so the preview's "would
// have alerted" count matches what the engine would actually have done.
//
// Defaults (from CROSS_CUTTING.md §3):
//   info     → 15 min
//   warn     →  5 min
//   critical →  1 min
// Per-rule override via `params.cooldown_seconds`.

import type { AlertSeverity } from '../db/alerts.ts';
import type { AlertRule } from './types.ts';

const DEFAULT_COOLDOWN_SECONDS: Record<AlertSeverity, number> = {
  info: 15 * 60,
  warn: 5 * 60,
  critical: 60,
};

export function cooldownSeconds(rule: AlertRule): number {
  const override = (rule.params as { cooldown_seconds?: number }).cooldown_seconds;
  if (override != null) return override;
  const def = DEFAULT_COOLDOWN_SECONDS[rule.severity];
  // Severity is a finite enum with all keys present in the map; the
  // `?? 0` is unreachable but satisfies strict noUncheckedIndexedAccess.
  return def ?? 0;
}

/** True when `lastFiredAt` is within the cooldown window of `now` for
 *  this rule. The engine should pre-filter to unacked alerts and to
 *  alerts written *after* `rule.updated_at` (so a re-enable / threshold
 *  edit isn't suppressed by a pre-edit firing — see CROSS_CUTTING §3).
 *
 *  When `lastFiredAt` is null (no prior unacked alert in scope), the
 *  rule is never within cooldown. */
export function withinCooldown(rule: AlertRule, lastFiredAt: string | null, now: string): boolean {
  if (lastFiredAt == null) return false;
  const elapsedSeconds = (Date.parse(now) - Date.parse(lastFiredAt)) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return false;
  return elapsedSeconds < cooldownSeconds(rule);
}
