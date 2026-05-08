// F11 RulePreview engine. Walks the supplied 24 h window in chronological
// order, calls evaluateRule per data point with the appropriate history
// slice, and tracks per-rule cooldown so the count matches what the live
// engine would have written.
//
// Pure (no IO, no Date.now()) so a future parity test can drive both the
// engine path and this preview path with the same inputs and assert
// identical outputs — same SSOT contract as the rules engine handler.

import {
  evaluateRule,
  withinCooldown,
  type AlertRule,
  type AlertSeverity,
  type DataPoint,
  type EventRow,
  type HistoryWindow,
  type PositionEstimateRow,
  type SensorReadingRow,
} from '@alzcare/shared';

interface PreviewInput {
  rule: AlertRule;
  sensors: SensorReadingRow[];
  positions: PositionEstimateRow[];
  events: EventRow[];
  /** Now-anchor for the inactivity tick. */
  now: string;
}

export interface PreviewHit {
  fired_at: string;
  severity: AlertSeverity;
  context: Record<string, unknown>;
}

export interface PreviewResult {
  hits: PreviewHit[];
  byseverity: Record<AlertSeverity, number>;
}

const TICK_INTERVAL_MS = 60_000;

export function previewRule(input: PreviewInput): PreviewResult {
  const stream = buildStream(input);
  // Walk the stream forward in time, accumulating positions for the
  // dwell-time history slice. Sensors + events history are not used by
  // any current evaluator branch, so we keep the slices empty for them.
  const positionsAcc: PositionEstimateRow[] = [];
  const hits: PreviewHit[] = [];
  let lastFiredAt: string | null = null;

  for (const item of stream) {
    if (item.kind === 'position_estimate') {
      positionsAcc.unshift(item.row);
    }
    const dp: DataPoint = item;
    const dpAt = dataPointAt(dp);
    const history: HistoryWindow = {
      positions: positionsAcc,
      sensors: [],
      events: [],
    };
    const result = evaluateRule(input.rule, dp, history);
    if (!result.fire) continue;
    if (withinCooldown(input.rule, lastFiredAt, dpAt)) continue;
    hits.push({ fired_at: dpAt, severity: result.severity, context: result.context });
    lastFiredAt = dpAt;
  }

  const byseverity: Record<AlertSeverity, number> = { info: 0, warn: 0, critical: 0 };
  for (const h of hits) byseverity[h.severity] += 1;
  return { hits, byseverity };
}

function buildStream(input: PreviewInput): DataPoint[] {
  const items: DataPoint[] = [];
  // Sensors / positions / events feed their respective branches (vitals
  // / zone / fall). Inactivity gets one synthetic tick per minute over
  // the window.
  for (const r of input.sensors) items.push({ kind: 'sensor_reading', row: r });
  for (const r of input.positions) items.push({ kind: 'position_estimate', row: r });
  for (const r of input.events) items.push({ kind: 'event', row: r });

  if (input.rule.type === 'inactivity') {
    const nowMs = Date.parse(input.now);
    const startMs = nowMs - 24 * 60 * 60 * 1000;
    for (let t = startMs; t <= nowMs; t += TICK_INTERVAL_MS) {
      items.push({ kind: 'tick', at: new Date(t).toISOString() });
    }
  }

  items.sort((a, b) => dataPointAt(a).localeCompare(dataPointAt(b)));
  return items;
}

function dataPointAt(dp: DataPoint): string {
  switch (dp.kind) {
    case 'sensor_reading':
      return dp.row.recorded_at;
    case 'position_estimate':
      return dp.row.recorded_at;
    case 'event':
      return dp.row.occurred_at;
    case 'tick':
      return dp.at;
  }
}
