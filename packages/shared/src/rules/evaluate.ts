// F11: pure rule evaluator. The single source of truth shared by:
//   - apps/edge/functions/rules_engine — live alert path
//   - apps/edge/functions/inactivity_scan — minute-cron path (inactivity)
//   - apps/web/src/features/alerts/RulePreview — "would have alerted in
//     last 24 h" dry-run
//
// Pure: no Date.now(), no DB calls, no realtime side-effects. The
// caller passes `now` either via the dataPoint timestamp or via a
// `tick` data point. This is what makes the parity test possible.

import type {
  AlertRule,
  DataPoint,
  EvaluatorResult,
  HistoryWindow,
  InactivityRule,
  VitalsRule,
  ZoneRule,
} from './types.ts';
import type { PositionEstimateRow } from '../db/position-estimates.ts';

/** Default canvas-pixel motion floor used when an inactivity rule
 *  doesn't override it. Five pixels at the seed plan's
 *  scale (0.014 m/px) ≈ 7 cm — well under realistic body sway. */
export const DEFAULT_MOTION_FLOOR_PX = 5;

export function evaluateRule(
  rule: AlertRule,
  dataPoint: DataPoint,
  history: HistoryWindow,
): EvaluatorResult {
  if (!rule.enabled) return { fire: false };

  switch (rule.type) {
    case 'vitals':
      return evaluateVitals(rule, dataPoint);
    case 'fall':
      return evaluateFall(rule, dataPoint);
    case 'zone':
      return evaluateZone(rule, dataPoint, history);
    case 'inactivity':
      return evaluateInactivity(rule, dataPoint, history);
  }
}

// ─── vitals ───────────────────────────────────────────────────────────

function evaluateVitals(rule: VitalsRule, dp: DataPoint): EvaluatorResult {
  if (dp.kind !== 'sensor_reading') return { fire: false };
  const value = dp.row[rule.params.metric];
  if (value == null || !Number.isFinite(value)) return { fire: false };
  const { min, max } = rule.params;
  let breached: 'low' | 'high' | null = null;
  if (min != null && value < min) breached = 'low';
  else if (max != null && value > max) breached = 'high';
  if (breached == null) return { fire: false };
  return {
    fire: true,
    severity: rule.severity,
    context: {
      kind: 'vitals',
      metric: rule.params.metric,
      value,
      min: rule.params.min,
      max: rule.params.max,
      breached,
      sensor_reading_id: dp.row.id,
      recorded_at: dp.row.recorded_at,
    },
  };
}

// ─── fall ─────────────────────────────────────────────────────────────

function evaluateFall(rule: AlertRule, dp: DataPoint): EvaluatorResult {
  if (dp.kind !== 'event') return { fire: false };
  if (dp.row.type !== 'fall') return { fire: false };
  return {
    fire: true,
    severity: rule.severity,
    context: {
      kind: 'fall',
      event_id: dp.row.id,
      device_id: dp.row.device_id,
      occurred_at: dp.row.occurred_at,
      payload: dp.row.payload,
    },
  };
}

// ─── zone ─────────────────────────────────────────────────────────────

function evaluateZone(rule: ZoneRule, dp: DataPoint, history: HistoryWindow): EvaluatorResult {
  if (dp.kind !== 'position_estimate') return { fire: false };
  const row = dp.row;
  if (row.mode !== 'indoor' || row.x_canvas == null || row.y_canvas == null) {
    return { fire: false };
  }
  const inside = pointInPolygon([row.x_canvas, row.y_canvas], rule.params.polygon);
  const condition = rule.params.direction === 'enter' ? inside : !inside;
  if (!condition) return { fire: false };

  // Dwell-time gate: require the condition to have held continuously
  // for `dwell_seconds` against the supplied position history. History
  // is descending by recorded_at (newest first); we walk back collecting
  // rows whose timestamp is within the dwell window and confirm each
  // one matches the condition. If any row breaks the condition, the
  // dwell isn't satisfied.
  const dwellMs = rule.params.dwell_seconds * 1000;
  if (dwellMs > 0) {
    const cutoffMs = Date.parse(row.recorded_at) - dwellMs;
    for (const prior of history.positions) {
      if (prior.id === row.id) continue;
      const priorMs = Date.parse(prior.recorded_at);
      if (priorMs < cutoffMs) break; // walked past the window
      if (prior.mode !== 'indoor' || prior.x_canvas == null || prior.y_canvas == null) {
        return { fire: false };
      }
      const priorInside = pointInPolygon([prior.x_canvas, prior.y_canvas], rule.params.polygon);
      const priorCondition = rule.params.direction === 'enter' ? priorInside : !priorInside;
      if (!priorCondition) return { fire: false };
    }
    // If the oldest history row we considered is still newer than the
    // cutoff, we don't have enough history to confirm the dwell.
    const oldestInWindow = oldestInsideWindow(history.positions, row.id, cutoffMs);
    if (oldestInWindow == null || Date.parse(oldestInWindow.recorded_at) > cutoffMs) {
      return { fire: false };
    }
  }

  return {
    fire: true,
    severity: rule.severity,
    context: {
      kind: 'zone',
      direction: rule.params.direction,
      dwell_seconds: rule.params.dwell_seconds,
      position_estimate_id: row.id,
      x_canvas: row.x_canvas,
      y_canvas: row.y_canvas,
      recorded_at: row.recorded_at,
    },
  };
}

function oldestInsideWindow(
  positions: PositionEstimateRow[],
  excludeId: string,
  cutoffMs: number,
): PositionEstimateRow | null {
  let oldest: PositionEstimateRow | null = null;
  for (const p of positions) {
    if (p.id === excludeId) continue;
    const ms = Date.parse(p.recorded_at);
    if (ms < cutoffMs) break;
    oldest = p;
  }
  return oldest;
}

// ─── inactivity ───────────────────────────────────────────────────────

function evaluateInactivity(
  rule: InactivityRule,
  dp: DataPoint,
  history: HistoryWindow,
): EvaluatorResult {
  if (dp.kind !== 'tick') return { fire: false };
  // Optional time-of-day gate (caregiver-local HH:mm). When provided,
  // the rule only fires while the wall clock falls inside the window.
  if (rule.params.only_between != null) {
    if (!withinTimeWindow(dp.at, rule.params.only_between)) {
      return { fire: false };
    }
  }

  // Find the last "real motion" position by walking the history newest-
  // first and looking for a delta above the motion floor. If the most
  // recent motion is older than `inactive_minutes`, fire.
  const motionFloor = rule.params.motion_floor_px ?? DEFAULT_MOTION_FLOOR_PX;
  const inactiveMs = rule.params.inactive_minutes * 60 * 1000;
  const tickMs = Date.parse(dp.at);

  const indoorPositions = history.positions.filter(
    (p) => p.mode === 'indoor' && p.x_canvas != null && p.y_canvas != null,
  );
  if (indoorPositions.length === 0) return { fire: false };

  let lastMotionAt: string | null = null;
  for (let i = 0; i < indoorPositions.length - 1; i++) {
    const a = indoorPositions[i]!;
    const b = indoorPositions[i + 1]!;
    const dx = (a.x_canvas as number) - (b.x_canvas as number);
    const dy = (a.y_canvas as number) - (b.y_canvas as number);
    if (Math.hypot(dx, dy) >= motionFloor) {
      lastMotionAt = a.recorded_at;
      break;
    }
  }
  if (lastMotionAt == null) {
    // No motion observed at all in the supplied window. Treat the
    // window's newest sample as the last motion timestamp — the rule
    // can still fire if that sample is older than the threshold.
    lastMotionAt = indoorPositions[0]!.recorded_at;
  }

  const sinceMotionMs = tickMs - Date.parse(lastMotionAt);
  if (sinceMotionMs < inactiveMs) return { fire: false };

  return {
    fire: true,
    severity: rule.severity,
    context: {
      kind: 'inactivity',
      inactive_minutes: rule.params.inactive_minutes,
      last_motion_at: lastMotionAt,
      tick_at: dp.at,
      observed_inactive_seconds: Math.round(sinceMotionMs / 1000),
    },
  };
}

function withinTimeWindow(iso: string, window: { from: string; to: string }): boolean {
  const d = new Date(iso);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const fromM = parseHHMM(window.from);
  const toM = parseHHMM(window.to);
  if (fromM == null || toM == null) return true;
  if (fromM <= toM) return minutes >= fromM && minutes <= toM;
  // Overnight window (e.g. 22:00-06:00) wraps midnight.
  return minutes >= fromM || minutes <= toM;
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// ─── geometry ─────────────────────────────────────────────────────────

/** Standard ray-casting point-in-polygon. The polygon is defined by an
 *  ordered list of [x, y] vertices and is treated as implicitly closed
 *  (no need to repeat the first vertex). Edge cases: a point exactly on
 *  an edge can be reported either way; the prototype's polygons are
 *  hand-drawn so this rarely matters. */
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
