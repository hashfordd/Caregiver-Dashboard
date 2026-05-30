import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  pointToSegmentDistance,
  pointInSegmentRect,
  type AlertRule,
  type DataPoint,
  type DoorProximityRule,
  type HistoryWindow,
  type RoomTransitionRule,
} from '@alzcare/shared/rules';
import type { PositionEstimateRow } from '@alzcare/shared';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const ROOM_ID = '33333333-3333-3333-3333-333333333333';
const CONNECTOR_ID = '44444444-4444-4444-4444-444444444444';

const BEDROOM_POLY: [number, number][] = [
  [0, 0],
  [200, 0],
  [200, 200],
  [0, 200],
];

const FRONT_DOOR = { start_x: 200, start_y: 100, end_x: 220, end_y: 100 };

function pe(overrides: Partial<PositionEstimateRow> = {}): PositionEstimateRow {
  return {
    id: 'pe-1',
    patient_id: PATIENT,
    recorded_at: '2026-05-29T10:00:00Z',
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 100,
    lat: null,
    lng: null,
    confidence: 0.8,
    indoor_confidence: 0.8,
    gps_strong: false,
    created_at: '2026-05-29T10:00:00Z',
    ...overrides,
  };
}

function roomTransitionRule(overrides: Partial<RoomTransitionRule> = {}): RoomTransitionRule {
  return {
    id: 'rule-rt',
    patient_id: PATIENT,
    type: 'room_transition',
    severity: 'warn',
    enabled: true,
    created_at: '2026-05-29T00:00:00Z',
    updated_at: '2026-05-29T00:00:00Z',
    params: {
      room_id: ROOM_ID,
      direction: 'enter',
      dwell_seconds: 0,
    },
    ...overrides,
  };
}

function doorProximityRule(overrides: Partial<DoorProximityRule> = {}): DoorProximityRule {
  return {
    id: 'rule-dp',
    patient_id: PATIENT,
    type: 'door_proximity',
    severity: 'warn',
    enabled: true,
    created_at: '2026-05-29T00:00:00Z',
    updated_at: '2026-05-29T00:00:00Z',
    params: {
      connector_id: CONNECTOR_ID,
      radius_m: 1.0,
      dwell_seconds: 0,
    },
    ...overrides,
  };
}

const HISTORY: HistoryWindow = {
  positions: [],
  sensors: [],
  events: [],
  rooms: { [ROOM_ID]: { polygon_canvas: BEDROOM_POLY } },
  roomConnectors: { [CONNECTOR_ID]: FRONT_DOOR },
  // 0.02 m/px → radius_m = 1 → 50 px.
  scaleMetersPerPixel: 0.02,
};

describe('pointToSegmentDistance', () => {
  it('returns 0 when the point lies on the segment interior', () => {
    expect(pointToSegmentDistance(50, 0, 0, 0, 100, 0)).toBe(0);
  });

  it('returns the perpendicular distance for points above/below', () => {
    expect(pointToSegmentDistance(50, 30, 0, 0, 100, 0)).toBe(30);
    expect(pointToSegmentDistance(50, -30, 0, 0, 100, 0)).toBe(30);
  });

  it('clamps to the nearest endpoint when the projection falls outside the segment', () => {
    // Way past B; nearest point is B itself.
    expect(pointToSegmentDistance(200, 0, 0, 0, 100, 0)).toBe(100);
    // Behind A; nearest is A.
    expect(pointToSegmentDistance(-30, 40, 0, 0, 100, 0)).toBeCloseTo(50, 6);
  });

  it('handles a degenerate (zero-length) segment by returning the point-to-point distance', () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('evaluateRule — room_transition', () => {
  it('fires when an enter rule sees a position inside the room polygon', () => {
    const rule: AlertRule = roomTransitionRule();
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 50, y_canvas: 50 }) };
    const result = evaluateRule(rule, dp, HISTORY);
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.context).toMatchObject({
        kind: 'room_transition',
        room_id: ROOM_ID,
        direction: 'enter',
      });
    }
  });

  it('does not fire enter when the position is outside the polygon', () => {
    const rule: AlertRule = roomTransitionRule();
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 300, y_canvas: 300 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });

  it('exit direction inverts the polygon test', () => {
    const rule: AlertRule = roomTransitionRule({
      params: { room_id: ROOM_ID, direction: 'exit', dwell_seconds: 0 },
    });
    const inside: DataPoint = {
      kind: 'position_estimate',
      row: pe({ x_canvas: 50, y_canvas: 50 }),
    };
    const outside: DataPoint = {
      kind: 'position_estimate',
      row: pe({ x_canvas: 300, y_canvas: 300 }),
    };
    expect(evaluateRule(rule, inside, HISTORY).fire).toBe(false);
    expect(evaluateRule(rule, outside, HISTORY).fire).toBe(true);
  });

  it('skips cleanly when the referenced room is missing from history (e.g. deleted)', () => {
    const rule: AlertRule = roomTransitionRule({
      params: { room_id: 'no-such-room', direction: 'enter', dwell_seconds: 0 },
    });
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 50, y_canvas: 50 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });

  it('honours the dwell gate — withholds fire until enough prior matching rows exist', () => {
    const rule: AlertRule = roomTransitionRule({
      params: { room_id: ROOM_ID, direction: 'enter', dwell_seconds: 10 },
    });
    // Current row is inside, but history is empty → dwell can't be confirmed.
    const dpNow = pe({
      id: 'pe-now',
      recorded_at: '2026-05-29T10:00:10Z',
      x_canvas: 50,
      y_canvas: 50,
    });
    const noHist: DataPoint = { kind: 'position_estimate', row: dpNow };
    expect(evaluateRule(rule, noHist, HISTORY).fire).toBe(false);

    // With a prior row 10 s earlier also inside, dwell is satisfied.
    const priorInside = pe({
      id: 'pe-prior',
      recorded_at: '2026-05-29T10:00:00Z',
      x_canvas: 60,
      y_canvas: 60,
    });
    const fullHistory: HistoryWindow = {
      ...HISTORY,
      positions: [priorInside],
    };
    expect(evaluateRule(rule, noHist, fullHistory).fire).toBe(true);

    // Break the dwell with a prior row that's outside.
    const priorOutside = pe({
      id: 'pe-prior',
      recorded_at: '2026-05-29T10:00:00Z',
      x_canvas: 300,
      y_canvas: 300,
    });
    const brokenHistory: HistoryWindow = {
      ...HISTORY,
      positions: [priorOutside],
    };
    expect(evaluateRule(rule, noHist, brokenHistory).fire).toBe(false);
  });
});

describe('evaluateRule — door_proximity', () => {
  it('fires when the position sits within radius_m of the connector', () => {
    // Door is at y=100, x in [200,220]. Position at (210, 100) is on the
    // segment → distance 0 m, well within radius_m=1.
    const rule: AlertRule = doorProximityRule();
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 100 }) };
    const result = evaluateRule(rule, dp, HISTORY);
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.context).toMatchObject({
        kind: 'door_proximity',
        connector_id: CONNECTOR_ID,
        radius_m: 1.0,
      });
      // distance_m is reported back at trigger time.
      expect((result.context as { distance_m: number }).distance_m).toBeCloseTo(0, 6);
    }
  });

  it('does not fire when the position is outside radius_m', () => {
    // 0.02 m/px × 100 px = 2 m away → outside radius_m=1.
    const rule: AlertRule = doorProximityRule();
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 200 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });

  it('skips when the connector is unknown (id stale or unloaded)', () => {
    const rule: AlertRule = doorProximityRule({
      params: { connector_id: 'no-such', radius_m: 1, dwell_seconds: 0 },
    });
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 100 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });

  it('skips when scaleMetersPerPixel is missing — radius cannot be converted to pixels', () => {
    const rule: AlertRule = doorProximityRule();
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 100 }) };
    const noScale: HistoryWindow = { ...HISTORY, scaleMetersPerPixel: undefined };
    expect(evaluateRule(rule, dp, noScale).fire).toBe(false);
  });

  it('ignores outdoor position estimates regardless of indoor proximity geometry', () => {
    const rule: AlertRule = doorProximityRule();
    const dp: DataPoint = {
      kind: 'position_estimate',
      row: pe({ mode: 'outdoor', x_canvas: null, y_canvas: null, lat: 0, lng: 0 }),
    };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });
});

describe('pointInSegmentRect', () => {
  // Horizontal segment: A=(0,0) B=(100,0), radius=10.
  // The oriented rect spans x in [-10, 110], y in [-10, 10].

  it('returns true for a point on the segment interior', () => {
    expect(pointInSegmentRect(50, 0, 0, 0, 100, 0, 10)).toBe(true);
  });

  it('returns true for a point inside the perp band beside the middle', () => {
    expect(pointInSegmentRect(50, 9, 0, 0, 100, 0, 10)).toBe(true);
    expect(pointInSegmentRect(50, -9, 0, 0, 100, 0, 10)).toBe(true);
  });

  it('returns false for a point outside the perp band', () => {
    expect(pointInSegmentRect(50, 11, 0, 0, 100, 0, 10)).toBe(false);
    expect(pointInSegmentRect(50, -11, 0, 0, 100, 0, 10)).toBe(false);
  });

  it('returns true inside the end caps (extended by radius past endpoints)', () => {
    // Left end cap: x in [-10, 0], perp within ±10.
    expect(pointInSegmentRect(-9, 0, 0, 0, 100, 0, 10)).toBe(true);
    // Right end cap: x in [100, 110].
    expect(pointInSegmentRect(109, 0, 0, 0, 100, 0, 10)).toBe(true);
  });

  it('returns false outside the end caps', () => {
    expect(pointInSegmentRect(-11, 0, 0, 0, 100, 0, 10)).toBe(false);
    expect(pointInSegmentRect(111, 0, 0, 0, 100, 0, 10)).toBe(false);
  });

  it('handles a degenerate (zero-length) segment as a circle', () => {
    // Point at (3, 4): distance = 5 from origin.
    expect(pointInSegmentRect(3, 4, 0, 0, 0, 0, 5)).toBe(true);
    expect(pointInSegmentRect(3, 4, 0, 0, 0, 0, 4)).toBe(false);
  });

  it('works for a diagonal segment', () => {
    // Segment A=(0,0) B=(10,10). Unit along = (1/√2, 1/√2).
    // Point at (5, 5) is the midpoint → on the segment → inside with r=1.
    expect(pointInSegmentRect(5, 5, 0, 0, 10, 10, 1)).toBe(true);
    // Point at (5, 7) is 2/√2 ≈ 1.41 px from the line → outside r=1.
    expect(pointInSegmentRect(5, 7, 0, 0, 10, 10, 1)).toBe(false);
    // Point at (5, 6) is 1/√2 ≈ 0.71 px from the line → inside r=1.
    expect(pointInSegmentRect(5, 6, 0, 0, 10, 10, 1)).toBe(true);
  });
});

describe('evaluateRule — door_proximity (shape=rectangle)', () => {
  // FRONT_DOOR: horizontal segment x=[200..220], y=100. scale 0.02 m/px.
  // radius_m=1.0 → radiusPx=50. Rect spans x=[150..270], y=[50..150].

  it('fires when the position is inside the rectangle zone', () => {
    const rule: AlertRule = doorProximityRule({
      params: { connector_id: CONNECTOR_ID, radius_m: 1.0, dwell_seconds: 0, shape: 'rectangle' },
    });
    // Position squarely inside the rect (beside the door, within 50 px along).
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 130 }) };
    const result = evaluateRule(rule, dp, HISTORY);
    expect(result.fire).toBe(true);
  });

  it('does not fire when the position is outside the rectangle zone', () => {
    const rule: AlertRule = doorProximityRule({
      params: { connector_id: CONNECTOR_ID, radius_m: 1.0, dwell_seconds: 0, shape: 'rectangle' },
    });
    // y=160 is 60 px from the door (> radiusPx=50) — outside.
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 160 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(false);
  });

  it('fires for a position in the end cap (not within segment distance, but inside rect)', () => {
    const rule: AlertRule = doorProximityRule({
      params: { connector_id: CONNECTOR_ID, radius_m: 1.0, dwell_seconds: 0, shape: 'rectangle' },
    });
    // x=160 is 40 px left of the segment start (200) — inside the end cap.
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 160, y_canvas: 100 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(true);
  });

  it('does not affect the default segment path (shape omitted)', () => {
    // The default (no shape) still uses point-to-segment distance.
    const rule: AlertRule = doorProximityRule({
      params: { connector_id: CONNECTOR_ID, radius_m: 1.0, dwell_seconds: 0 },
    });
    // y=130 is 30 px from the door (within 50 px point-to-segment) → still fires.
    const dp: DataPoint = { kind: 'position_estimate', row: pe({ x_canvas: 210, y_canvas: 130 }) };
    expect(evaluateRule(rule, dp, HISTORY).fire).toBe(true);
  });
});
