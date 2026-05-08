import { describe, it, expect } from 'vitest';
import type {
  EventRow,
  PositionEstimateRow,
  SensorReadingRow,
  VitalsRule,
  ZoneRule,
} from '@alzcare/shared';
import { previewRule } from '@/features/alerts/previewRule';

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

function position(t: string, x: number, y: number): PositionEstimateRow {
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

function event(t: string, type: EventRow['type']): EventRow {
  return {
    id: `ev-${t}`,
    patient_id: PATIENT,
    device_id: DEVICE,
    occurred_at: t,
    type,
    payload: {},
    created_at: t,
  };
}

const VITALS_HR: VitalsRule = {
  id: 'r-v',
  patient_id: PATIENT,
  severity: 'warn',
  enabled: true,
  type: 'vitals',
  params: { metric: 'hr_bpm', min: 50, max: 110 },
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

const ZONE_RULE: ZoneRule = {
  id: 'r-z',
  patient_id: PATIENT,
  severity: 'critical',
  enabled: true,
  type: 'zone',
  params: {
    space: 'indoor',
    polygon: [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ],
    direction: 'enter',
    dwell_seconds: 0,
  },
  created_at: '2026-05-06T00:00:00Z',
  updated_at: '2026-05-06T00:00:00Z',
};

describe('previewRule (vitals)', () => {
  it('counts each breach beyond cooldown as a hit', () => {
    const sensors = [
      sensorReading('2026-05-06T10:00:00Z', 80), // ok
      sensorReading('2026-05-06T10:01:00Z', 200), // breach
      sensorReading('2026-05-06T10:02:00Z', 200), // suppressed (within warn 5 min cooldown)
      sensorReading('2026-05-06T10:30:00Z', 200), // beyond cooldown → fires
    ];
    const result = previewRule({
      rule: VITALS_HR,
      sensors,
      positions: [],
      events: [],
      now: '2026-05-06T11:00:00Z',
    });
    expect(result.hits.length).toBe(2);
    expect(result.byseverity.warn).toBe(2);
  });

  it('returns no hits when nothing breached', () => {
    const sensors = [
      sensorReading('2026-05-06T10:00:00Z', 70),
      sensorReading('2026-05-06T10:05:00Z', 80),
    ];
    const result = previewRule({
      rule: VITALS_HR,
      sensors,
      positions: [],
      events: [],
      now: '2026-05-06T11:00:00Z',
    });
    expect(result.hits.length).toBe(0);
  });
});

describe('previewRule (zone)', () => {
  it('fires once per polygon entry beyond cooldown', () => {
    const positions = [
      position('2026-05-06T10:00:00Z', 100, 100), // inside
      position('2026-05-06T10:00:30Z', 100, 100), // suppressed (critical 60 s cooldown)
      position('2026-05-06T10:02:00Z', 100, 100), // beyond cooldown → fires
      position('2026-05-06T10:03:00Z', 500, 500), // outside
    ];
    const result = previewRule({
      rule: ZONE_RULE,
      sensors: [],
      positions,
      events: [],
      now: '2026-05-06T11:00:00Z',
    });
    expect(result.byseverity.critical).toBe(2);
  });
});

describe('previewRule (fall)', () => {
  it('fires for each fall event beyond cooldown', () => {
    const events = [event('2026-05-06T10:00:00Z', 'fall'), event('2026-05-06T10:00:30Z', 'fall')];
    const result = previewRule({
      rule: {
        id: 'r-f',
        patient_id: PATIENT,
        severity: 'critical',
        enabled: true,
        type: 'fall',
        params: {},
        created_at: '2026-05-06T00:00:00Z',
        updated_at: '2026-05-06T00:00:00Z',
      },
      sensors: [],
      positions: [],
      events,
      now: '2026-05-06T11:00:00Z',
    });
    // Critical 60 s cooldown — second fall is within window, suppressed.
    expect(result.hits.length).toBe(1);
  });
});
