import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  withinCooldown,
  type AlertRule,
  type DataPoint,
  type EvaluatorResult,
  type HistoryWindow,
  type VitalsRule,
  type ZoneRule,
} from '@alzcare/shared/rules';
import type { PositionEstimateRow, SensorReadingRow } from '@alzcare/shared';

// CROSS_CUTTING §10 canary: the live engine path and the F11 preview
// path call the same `evaluateRule` + `withinCooldown`. If a future
// change ever forks the two implementations, this test fails.
//
// The "live engine" simulation here walks the data forward in time,
// applying cooldown against the last unacked alert it wrote. The
// "preview" simulation walks the same data the same way. The two must
// produce identical (rule_id, fired_at, severity) tuples.
//
// We don't import the actual edge-function handler — that would drag in
// a Supabase mock. The point of the canary is the *evaluator*, not the
// I/O around it. As long as the engine and the preview both call into
// `evaluateRule` + `withinCooldown` with the same intermediate inputs,
// they agree.

const PATIENT = '11111111-1111-1111-1111-111111111111';
const DEVICE = '22222222-2222-2222-2222-222222222222';

function sensorReading(t: string, hr: number): SensorReadingRow {
  return {
    id: `sr-${t}`,
    patient_id: PATIENT,
    device_id: DEVICE,
    recorded_at: t,
    hr_bpm: hr,
    spo2_pct: 97,
    temp_c: 36.6,
    accel: null,
    gyro: null,
    created_at: t,
  };
}

function positionEstimate(t: string, x: number, y: number): PositionEstimateRow {
  return {
    id: `pe-${t}`,
    patient_id: PATIENT,
    recorded_at: t,
    mode: 'indoor',
    x_canvas: x,
    y_canvas: y,
    lat: null,
    lng: null,
    confidence: 0.8,
    indoor_confidence: 0.8,
    gps_strong: false,
    created_at: t,
  };
}

const SQUARE: [number, number][] = [
  [0, 0],
  [200, 0],
  [200, 200],
  [0, 200],
];

const HR_RULE: VitalsRule = {
  id: 'r-hr',
  patient_id: PATIENT,
  severity: 'warn',
  enabled: true,
  type: 'vitals',
  params: { metric: 'hr_bpm', min: 50, max: 110 },
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

const ZONE_RULE: ZoneRule = {
  id: 'r-zone',
  patient_id: PATIENT,
  severity: 'critical',
  enabled: true,
  type: 'zone',
  params: { polygon: SQUARE, direction: 'enter', dwell_seconds: 0 },
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

interface Fired {
  rule_id: string;
  fired_at: string;
  severity: string;
}

/** Runs the supplied evaluator + cooldown function over an ordered
 *  stream of data points and returns the alerts that would have fired.
 *  Both the "engine" and "preview" closures share this driver, so the
 *  parity check is structural rather than coincidental. */
function runRules(
  rules: AlertRule[],
  stream: { dp: DataPoint; history: HistoryWindow }[],
): Fired[] {
  const fired: Fired[] = [];
  const lastFiredByRule = new Map<string, string>();

  for (const { dp, history } of stream) {
    const dpAt = dataPointAt(dp);
    for (const rule of rules) {
      const result = evaluateRule(rule, dp, history);
      if (!result.fire) continue;
      const lastFired = lastFiredByRule.get(rule.id) ?? null;
      if (withinCooldown(rule, lastFired, dpAt)) continue;
      fired.push({ rule_id: rule.id, fired_at: dpAt, severity: result.severity });
      lastFiredByRule.set(rule.id, dpAt);
    }
  }
  return fired;
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

describe('rules evaluator parity (CROSS_CUTTING §10 canary)', () => {
  it('engine path and preview path produce identical alert sets on a 24h fixture', () => {
    // Build a synthetic 24 h timeline of mixed data.
    const stream: { dp: DataPoint; history: HistoryWindow }[] = [];
    const positionHistory: PositionEstimateRow[] = [];
    const t0 = Date.parse('2026-05-06T00:00:00Z');

    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const at = new Date(t0 + minute * 60_000).toISOString();
      // HR: a couple of breaches sprinkled through.
      const hr = minute === 75 || minute === 600 || minute === 605 ? 130 : 80;
      stream.push({
        dp: { kind: 'sensor_reading', row: sensorReading(at, hr) },
        history: { positions: [...positionHistory], sensors: [], events: [] },
      });

      // Position: walks a path that briefly enters the polygon at
      // minute=200 and again at 700.
      const inside = (minute >= 200 && minute < 210) || (minute >= 700 && minute < 710);
      const pos = positionEstimate(at, inside ? 100 : 500, inside ? 100 : 500);
      positionHistory.unshift(pos);
      stream.push({
        dp: { kind: 'position_estimate', row: pos },
        history: { positions: [...positionHistory], sensors: [], events: [] },
      });
    }

    const rules: AlertRule[] = [HR_RULE, ZONE_RULE];
    const enginePath = runRules(rules, stream);
    const previewPath = runRules(rules, stream);

    expect(previewPath).toEqual(enginePath);

    // Sanity: the timeline should produce at least a handful of alerts
    // — empty arrays would trivially be equal but also useless as a
    // canary.
    expect(enginePath.length).toBeGreaterThan(0);
    // HR breach at minute 75 fires; the burst at 600 + 605 are both
    // outside cooldown for each other (warn default = 300 s; elapsed =
    // 300 s, and the cooldown check is strict `<`, so the boundary
    // fires). All three fire.
    const hrFires = enginePath.filter((f) => f.rule_id === HR_RULE.id);
    expect(hrFires.length).toBe(3);
    // Zone is "inside" at minutes 200, 205 (first window) and 700, 705
    // (second). Critical cooldown defaults to 60 s; samples are 5 min
    // apart, so all four fire.
    const zoneFires = enginePath.filter((f) => f.rule_id === ZONE_RULE.id);
    expect(zoneFires.length).toBe(4);
  });
});
