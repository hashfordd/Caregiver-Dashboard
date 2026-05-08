// F11: pure rule evaluator. The single source of truth shared by:
//   - apps/edge/functions/rules_engine — live alert path
//   - apps/edge/functions/inactivity_scan — minute-cron path (inactivity)
//   - apps/web/src/features/alerts/RulePreview — "would have alerted in
//     last 24 h" dry-run
//
// Pure: no Date.now(), no DB calls, no realtime side-effects. The
// caller passes `now` either via the dataPoint timestamp or via a
// `tick` data point. This is what makes the parity test possible.
//
// Phase C: zone dispatch on `params.space` (indoor canvas vs outdoor
// geofence); withinTimeWindow now resolves wall-clock against
// APP_TIMEZONE (Australia/Sydney) instead of the caller's local zone.

import { APP_TIMEZONE } from '../index.ts';
import type {
  AlertRule,
  DataPoint,
  DeviceSilenceRule,
  EvaluatorResult,
  HistoryWindow,
  InactivityRule,
  IndoorZoneParams,
  OutdoorZoneParams,
  VitalsRule,
  ZoneRule,
} from './types.ts';
import type { PositionEstimateRow } from '../db/position-estimates.ts';

/** Default canvas-pixel motion floor used when an inactivity rule
 *  doesn't override it. 25 px ≈ 0.5 m at a typical 50 px/m floor plan
 *  scale — above the ~30 cm noise of 1 Hz BLE trilateration so a
 *  stationary patient doesn't false-positive as moving, while still
 *  being well below any real ambulatory displacement. */
export const DEFAULT_MOTION_FLOOR_PX = 25;

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
    case 'device_silence':
      return evaluateDeviceSilence(rule, dataPoint, history);
  }
}

// Item 131: device_silence is a tick-driven rule (no per-row trigger).
// Caller fetches the patient's most recent telemetry sample and passes
// it via `history.sensors[0]` (newest first). When sensors is empty,
// gate against `rule.updated_at` so a freshly-enabled rule on a
// long-silent patient doesn't fire instantly.
function evaluateDeviceSilence(
  rule: DeviceSilenceRule,
  dp: DataPoint,
  history: HistoryWindow,
): EvaluatorResult {
  if (dp.kind !== 'tick') return { fire: false };
  const nowMs = Date.parse(dp.at);
  const newest = history.sensors[0];
  const lastSeenMs = newest
    ? Date.parse(newest.recorded_at)
    : Date.parse(rule.updated_at);
  const silentMs = nowMs - lastSeenMs;
  const thresholdMs = rule.params.silence_minutes * 60_000;
  if (silentMs < thresholdMs) return { fire: false };
  return {
    fire: true,
    severity: rule.severity,
    context: {
      kind: 'device_silence',
      silence_minutes: rule.params.silence_minutes,
      device_last_seen_at: newest?.recorded_at ?? null,
      silence_ms: silentMs,
      tick_at: dp.at,
    },
  };
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

/** Zone rules are discriminated by `params.space`. Indoor zones use
 *  canvas (x_canvas, y_canvas) coordinates and require the position
 *  estimate's mode to be 'indoor'. Outdoor zones use [lng, lat] GeoJSON
 *  pairs and require mode 'outdoor'. The dwell-time check is shared. */
function evaluateZone(rule: ZoneRule, dp: DataPoint, history: HistoryWindow): EvaluatorResult {
  if (dp.kind !== 'position_estimate') return { fire: false };
  const row = dp.row;
  const space = rule.params.space;

  const point = pointForSpace(row, space);
  if (point == null) return { fire: false };

  const polygon = polygonForSpace(rule.params);
  const inside = pointInPolygon(point, polygon);
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
      const priorPoint = pointForSpace(prior, space);
      if (priorPoint == null) return { fire: false };
      const priorInside = pointInPolygon(priorPoint, polygon);
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
      space,
      direction: rule.params.direction,
      dwell_seconds: rule.params.dwell_seconds,
      position_estimate_id: row.id,
      ...(space === 'indoor'
        ? { x_canvas: row.x_canvas, y_canvas: row.y_canvas }
        : { lat: row.lat, lng: row.lng }),
      recorded_at: row.recorded_at,
    },
  };
}

function pointForSpace(
  row: PositionEstimateRow,
  space: 'indoor' | 'outdoor',
): [number, number] | null {
  if (space === 'indoor') {
    if (row.mode !== 'indoor' || row.x_canvas == null || row.y_canvas == null) return null;
    return [row.x_canvas, row.y_canvas];
  }
  if (row.mode !== 'outdoor' || row.lat == null || row.lng == null) return null;
  // Outdoor polygons use GeoJSON [lng, lat] convention.
  return [row.lng, row.lat];
}

function polygonForSpace(params: IndoorZoneParams | OutdoorZoneParams): [number, number][] {
  if (params.space === 'indoor') return params.polygon;
  // Strip the GeoJSON closing duplicate vertex; pointInPolygon treats
  // the polygon as implicitly closed.
  const c = params.geofence.coordinates;
  return c.length >= 2 && c[0]?.[0] === c[c.length - 1]?.[0] && c[0]?.[1] === c[c.length - 1]?.[1]
    ? (c.slice(0, -1) as [number, number][])
    : (c as [number, number][]);
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
  // Optional time-of-day gate evaluated in APP_TIMEZONE (Australia/Sydney).
  // When provided, the rule only fires while the AEST/AEDT wall clock
  // falls inside the window.
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
    // No motion observed at all in the supplied window. Anchor to the
    // OLDEST sample in the lookback — semantically "we have evidence of
    // stationarity at least back to this point." This makes sinceMotionMs
    // grow with the lookback window and become large enough to fire, so a
    // streaming-but-stationary patient is correctly detected once the
    // threshold is exceeded.
    lastMotionAt = indoorPositions[indoorPositions.length - 1]!.recorded_at;
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

/** Resolves an ISO timestamp into an HH:mm in APP_TIMEZONE and tests
 *  whether it falls inside the supplied window. Handles wraparound
 *  (e.g. 22:00–06:00 spans midnight). */
export function withinTimeWindow(iso: string, window: { from: string; to: string }): boolean {
  const minutes = minutesInAppTz(iso);
  if (minutes == null) return true;
  const fromM = parseHHMM(window.from);
  const toM = parseHHMM(window.to);
  if (fromM == null || toM == null) return true;
  if (fromM <= toM) return minutes >= fromM && minutes <= toM;
  // Overnight window (e.g. 22:00–06:00) wraps midnight.
  return minutes >= fromM || minutes <= toM;
}

function minutesInAppTz(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Intl is the only standards-compliant way to extract wall-clock
  // hours/minutes in a non-runtime timezone. en-AU + 24-hour avoids the
  // AM/PM split. Format gives parts like { hour: '14', minute: '07' }.
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  let h = -1;
  let m = -1;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value);
    else if (p.type === 'minute') m = Number(p.value);
  }
  // Some en-AU implementations emit '24' for midnight; normalise.
  if (h === 24) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
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
 *  (no need to repeat the first vertex). For lat/lng polygons the
 *  caller passes [lng, lat] pairs (GeoJSON ordering) — same algorithm,
 *  same correctness because the test is purely topological. */
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
