import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  pointInPolygon,
  type AlertRule,
  type DataPoint,
  type FallRule,
  type HistoryWindow,
  type InactivityRule,
  type VitalsRule,
  type ZoneRule,
} from '@alzcare/shared/rules';
import type { EventRow, PositionEstimateRow, SensorReadingRow } from '@alzcare/shared';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const DEVICE = '22222222-2222-2222-2222-222222222222';

const EMPTY_HISTORY: HistoryWindow = { positions: [], sensors: [], events: [] };

function sensorReading(overrides: Partial<SensorReadingRow> = {}): SensorReadingRow {
  return {
    id: 'sr-1',
    patient_id: PATIENT,
    device_id: DEVICE,
    recorded_at: '2026-05-06T10:00:00Z',
    hr_bpm: 80,
    spo2_pct: 97,
    temp_c: 36.6,
    accel: null,
    gyro: null,
    created_at: '2026-05-06T10:00:00Z',
    ...overrides,
  };
}

function positionEstimate(overrides: Partial<PositionEstimateRow> = {}): PositionEstimateRow {
  return {
    id: 'pe-1',
    patient_id: PATIENT,
    recorded_at: '2026-05-06T10:00:00Z',
    mode: 'indoor',
    x_canvas: 100,
    y_canvas: 100,
    lat: null,
    lng: null,
    confidence: 0.8,
    indoor_confidence: 0.8,
    gps_strong: false,
    created_at: '2026-05-06T10:00:00Z',
    ...overrides,
  };
}

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'ev-1',
    patient_id: PATIENT,
    device_id: DEVICE,
    occurred_at: '2026-05-06T10:00:00Z',
    type: 'fall',
    payload: {},
    created_at: '2026-05-06T10:00:00Z',
    ...overrides,
  };
}

const SQUARE: [number, number][] = [
  [0, 0],
  [200, 0],
  [200, 200],
  [0, 200],
];

function vitalsRule(overrides: Partial<VitalsRule> = {}): VitalsRule {
  return {
    id: 'r-vitals',
    patient_id: PATIENT,
    severity: 'warn',
    enabled: true,
    type: 'vitals',
    params: { metric: 'hr_bpm', min: 50, max: 110 },
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  } as VitalsRule;
}

function zoneRule(overrides: Partial<ZoneRule> = {}): ZoneRule {
  return {
    id: 'r-zone',
    patient_id: PATIENT,
    severity: 'warn',
    enabled: true,
    type: 'zone',
    params: { polygon: SQUARE, direction: 'enter', dwell_seconds: 0 },
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  } as ZoneRule;
}

function fallRule(overrides: Partial<FallRule> = {}): FallRule {
  return {
    id: 'r-fall',
    patient_id: PATIENT,
    severity: 'critical',
    enabled: true,
    type: 'fall',
    params: {},
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  } as FallRule;
}

function inactivityRule(overrides: Partial<InactivityRule> = {}): InactivityRule {
  return {
    id: 'r-inact',
    patient_id: PATIENT,
    severity: 'warn',
    enabled: true,
    type: 'inactivity',
    params: { inactive_minutes: 30 },
    created_at: '2026-05-06T00:00:00Z',
    updated_at: '2026-05-06T00:00:00Z',
    ...overrides,
  } as InactivityRule;
}

describe('evaluateRule (vitals)', () => {
  it('fires when hr_bpm exceeds the upper bound', () => {
    const result = evaluateRule(
      vitalsRule(),
      { kind: 'sensor_reading', row: sensorReading({ hr_bpm: 150 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.severity).toBe('warn');
      expect(result.context.breached).toBe('high');
      expect(result.context.value).toBe(150);
    }
  });

  it('fires when hr_bpm is below the lower bound', () => {
    const result = evaluateRule(
      vitalsRule(),
      { kind: 'sensor_reading', row: sensorReading({ hr_bpm: 40 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(true);
    if (result.fire) expect(result.context.breached).toBe('low');
  });

  it('does not fire on values inside the range', () => {
    const result = evaluateRule(
      vitalsRule(),
      { kind: 'sensor_reading', row: sensorReading({ hr_bpm: 80 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });

  it('does not fire on a different metric', () => {
    const result = evaluateRule(
      vitalsRule({ params: { metric: 'spo2_pct', min: 92, max: null } }),
      { kind: 'sensor_reading', row: sensorReading({ spo2_pct: 95 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });

  it('does not fire on null sensor values', () => {
    const result = evaluateRule(
      vitalsRule(),
      { kind: 'sensor_reading', row: sensorReading({ hr_bpm: null }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });

  it('does not fire when the rule is disabled', () => {
    const result = evaluateRule(
      vitalsRule({ enabled: false }),
      { kind: 'sensor_reading', row: sensorReading({ hr_bpm: 200 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });
});

describe('evaluateRule (fall)', () => {
  it('fires on a fall event', () => {
    const result = evaluateRule(
      fallRule(),
      { kind: 'event', row: eventRow({ type: 'fall' }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(true);
    if (result.fire) expect(result.severity).toBe('critical');
  });

  it('does not fire on non-fall events', () => {
    const result = evaluateRule(
      fallRule(),
      { kind: 'event', row: eventRow({ type: 'low_battery' }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });
});

describe('evaluateRule (zone)', () => {
  it('fires on entering the polygon when direction=enter and no dwell', () => {
    const result = evaluateRule(
      zoneRule(),
      { kind: 'position_estimate', row: positionEstimate({ x_canvas: 100, y_canvas: 100 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(true);
  });

  it('does not fire when the position is outside and direction=enter', () => {
    const result = evaluateRule(
      zoneRule(),
      { kind: 'position_estimate', row: positionEstimate({ x_canvas: 300, y_canvas: 300 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(false);
  });

  it('fires on exit when direction=exit and the patient just left', () => {
    const result = evaluateRule(
      zoneRule({ params: { polygon: SQUARE, direction: 'exit', dwell_seconds: 0 } }),
      { kind: 'position_estimate', row: positionEstimate({ x_canvas: 300, y_canvas: 300 }) },
      EMPTY_HISTORY,
    );
    expect(result.fire).toBe(true);
  });

  it('does not fire on outdoor or null-canvas estimates', () => {
    const out = evaluateRule(
      zoneRule(),
      {
        kind: 'position_estimate',
        row: positionEstimate({ mode: 'outdoor', x_canvas: null, y_canvas: null }),
      },
      EMPTY_HISTORY,
    );
    expect(out.fire).toBe(false);
  });

  it('with dwell_seconds > 0, fires only when the prior history confirms the condition for the full window', () => {
    const dwellSeconds = 5;
    const dwellRule = zoneRule({
      params: { polygon: SQUARE, direction: 'enter', dwell_seconds: dwellSeconds },
    });
    // Newest first; 5 + 1 rows covers the window with a comfortable margin.
    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-now',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:00:05Z',
      }),
      positionEstimate({
        id: 'p-1',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:04Z',
      }),
      positionEstimate({
        id: 'p-2',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:03Z',
      }),
      positionEstimate({
        id: 'p-3',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:02Z',
      }),
      positionEstimate({
        id: 'p-4',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:01Z',
      }),
      positionEstimate({
        id: 'p-5',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:00Z',
      }),
    ];
    const result = evaluateRule(
      dwellRule,
      {
        kind: 'position_estimate',
        row: positions[0]!,
      },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(true);
  });

  it('with dwell_seconds > 0, suppresses if the patient was outside during the window', () => {
    const dwellRule = zoneRule({
      params: { polygon: SQUARE, direction: 'enter', dwell_seconds: 5 },
    });
    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-now',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:00:05Z',
      }),
      // Mid-window the patient was outside the polygon → dwell broken.
      positionEstimate({
        id: 'p-1',
        x_canvas: 500,
        y_canvas: 500,
        recorded_at: '2026-05-06T10:00:03Z',
      }),
      positionEstimate({
        id: 'p-2',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:01Z',
      }),
      positionEstimate({
        id: 'p-3',
        x_canvas: 110,
        y_canvas: 110,
        recorded_at: '2026-05-06T10:00:00Z',
      }),
    ];
    const result = evaluateRule(
      dwellRule,
      { kind: 'position_estimate', row: positions[0]! },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(false);
  });
});

describe('evaluateRule (inactivity)', () => {
  it('fires when the most recent motion is older than inactive_minutes', () => {
    const tickAt = '2026-05-06T11:00:00Z';
    // Two stationary samples, both older than 30 min from the tick.
    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-1',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:25:00Z',
      }),
      positionEstimate({
        id: 'p-2',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:20:00Z',
      }),
    ];
    const result = evaluateRule(
      inactivityRule({ params: { inactive_minutes: 30 } }),
      { kind: 'tick', at: tickAt },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(true);
    if (result.fire) {
      expect(result.context.kind).toBe('inactivity');
    }
  });

  it('does not fire when there is recent motion above the floor', () => {
    const tickAt = '2026-05-06T11:00:00Z';
    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-1',
        x_canvas: 200,
        y_canvas: 200,
        recorded_at: '2026-05-06T10:59:00Z',
      }),
      positionEstimate({
        id: 'p-2',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:58:00Z',
      }),
    ];
    const result = evaluateRule(
      inactivityRule({ params: { inactive_minutes: 30 } }),
      { kind: 'tick', at: tickAt },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(false);
  });

  it('treats sub-floor jitter as no-motion', () => {
    const tickAt = '2026-05-06T11:00:00Z';
    // 1 px wobble over an hour — well under the default 5 px floor.
    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-1',
        x_canvas: 101,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:30:00Z',
      }),
      positionEstimate({
        id: 'p-2',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T10:00:00Z',
      }),
    ];
    const result = evaluateRule(
      inactivityRule({ params: { inactive_minutes: 30 } }),
      { kind: 'tick', at: tickAt },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(true);
  });

  it('respects the optional only_between time-of-day window', () => {
    // The window is interpreted in caregiver-local time (Date.getHours()).
    // To stay TZ-agnostic in CI: pick a tick whose *local* hour we
    // compute on the fly, then build a window that explicitly excludes
    // it (one minute earlier than the local hour).
    const tickAt = '2026-05-06T12:00:00Z';
    const localHour = new Date(tickAt).getHours();
    const otherHour = (localHour + 6) % 24; // far enough away to be unambiguous
    const fromHour = String(otherHour).padStart(2, '0');
    const toHour = String((otherHour + 1) % 24).padStart(2, '0');

    const positions: PositionEstimateRow[] = [
      positionEstimate({
        id: 'p-1',
        x_canvas: 100,
        y_canvas: 100,
        recorded_at: '2026-05-06T11:00:00Z',
      }),
    ];
    const result = evaluateRule(
      inactivityRule({
        params: {
          inactive_minutes: 30,
          only_between: { from: `${fromHour}:00`, to: `${toHour}:00` },
        },
      }),
      { kind: 'tick', at: tickAt },
      { positions, sensors: [], events: [] },
    );
    expect(result.fire).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('reports a centre point as inside', () => {
    expect(pointInPolygon([100, 100], SQUARE)).toBe(true);
  });

  it('reports a far-away point as outside', () => {
    expect(pointInPolygon([500, 500], SQUARE)).toBe(false);
  });
});
