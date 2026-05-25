import { describe, it, expect } from 'vitest';
import {
  freshState,
  ingestHeartRate,
  ingestImu,
  ingestLocation,
  MOVEMENT_HIGH,
  type Mapping,
  type SynthContext,
} from '../lib/transform.ts';

const MAP: Mapping = {
  patient_id: '11111111-1111-1111-1111-111111111111',
  device_id: '22222222-2222-2222-2222-222222222222',
};
const NOW = '2026-05-25T04:00:00.000Z';

// Payloads mirror the prototype's build* helpers (D1-Generator.py / D1-Fall.py).
const hrPayload = (value: number) => ({
  patient_id: '001',
  sensor: 'heartrate',
  value,
  unit: 'bpm',
  timestamp: '2026-05-25T14:00:00',
});

function imuPayload(ax: number, ay: number, az: number) {
  const tilt = Math.round(Math.sqrt(ax * ax + ay * ay) * 1000) / 1000;
  const movement_rate = Math.round(Math.sqrt(ax * ax + ay * ay + az * az) * 1000) / 1000;
  return {
    patient_id: '001',
    sensor: 'imu',
    ax,
    ay,
    az,
    yaw: 0,
    pitch: 0,
    tilt,
    movement_rate,
    timestamp: '2026-05-25T14:00:00',
  };
}

describe('ingestHeartRate', () => {
  it('maps value → telemetry.hr_bpm with a fresh RFC3339 recorded_at', () => {
    const r = ingestHeartRate(MAP, freshState(), hrPayload(75), NOW);
    expect(r.error).toBeUndefined();
    expect(r.telemetry).toMatchObject({
      v: 1,
      patient_id: MAP.patient_id,
      device_id: MAP.device_id,
      recorded_at: NOW,
      hr_bpm: 75,
    });
    // Prototype's timezone-less timestamp must not leak through.
    expect(r.telemetry?.recorded_at).not.toBe('2026-05-25T14:00:00');
    expect(r.state.hr).toBe(75);
  });

  it('merges the latest cached IMU accel into telemetry', () => {
    let s = freshState();
    s = ingestImu(MAP, s, imuPayload(0.1, -0.1, 0.98), NOW).state;
    const r = ingestHeartRate(MAP, s, hrPayload(80), NOW);
    expect(r.telemetry?.accel).toEqual({ x: 0.1, y: -0.1, z: 0.98 });
  });

  it('emits accel-free telemetry before any IMU has arrived', () => {
    const r = ingestHeartRate(MAP, freshState(), hrPayload(70), NOW);
    expect(r.telemetry?.accel).toBeUndefined();
  });

  it('forwards spo2 and temp_c when the vitals payload includes them', () => {
    const r = ingestHeartRate(
      MAP,
      freshState(),
      { ...hrPayload(72), spo2: 97.5, temp_c: 36.8 },
      NOW,
    );
    expect(r.telemetry).toMatchObject({ hr_bpm: 72, spo2_pct: 97.5, temp_c: 36.8 });
  });

  it('omits spo2/temp_c when absent (HR-only payload)', () => {
    const r = ingestHeartRate(MAP, freshState(), hrPayload(72), NOW);
    expect(r.telemetry?.spo2_pct).toBeUndefined();
    expect(r.telemetry?.temp_c).toBeUndefined();
  });

  it('rejects a non-finite heart rate', () => {
    const r = ingestHeartRate(MAP, freshState(), hrPayload(NaN), NOW);
    expect(r.telemetry).toBeNull();
    expect(r.error).toMatch(/finite/);
  });

  it('rejects an out-of-range heart rate (Zod bound)', () => {
    const r = ingestHeartRate(MAP, freshState(), hrPayload(400), NOW);
    expect(r.telemetry).toBeNull();
    expect(r.error).toBeDefined();
  });
});

describe('ingestImu — fall latch', () => {
  it('does not fire on baseline movement (~1.0g gravity)', () => {
    const r = ingestImu(MAP, freshState(), imuPayload(0.15, -0.1, 0.97), NOW);
    expect(r.fall).toBeNull();
    expect(r.state.fallActive).toBe(false);
    expect(r.state.accel).toEqual({ x: 0.15, y: -0.1, z: 0.97 });
  });

  it('fires one fall event on the rising edge of a movement spike', () => {
    const r = ingestImu(MAP, freshState(), imuPayload(2.1, 2.0, 0.3), NOW);
    expect(r.fall).toMatchObject({
      v: 1,
      type: 'fall',
      patient_id: MAP.patient_id,
      occurred_at: NOW,
    });
    expect(r.state.fallActive).toBe(true);
    const mr = (r.fall?.payload as { movement_rate: number }).movement_rate;
    expect(mr).toBeGreaterThan(MOVEMENT_HIGH);
  });

  it('suppresses repeat falls while still down (latched)', () => {
    const s = ingestImu(MAP, freshState(), imuPayload(2.1, 2.0, 0.3), NOW).state;
    const again = ingestImu(MAP, s, imuPayload(2.2, 1.9, 0.2), NOW);
    expect(again.fall).toBeNull();
    expect(again.state.fallActive).toBe(true);
  });

  it('re-arms after movement normalises, then fires again', () => {
    const downed = ingestImu(MAP, freshState(), imuPayload(2.1, 2.0, 0.3), NOW).state;
    const s = ingestImu(MAP, downed, imuPayload(0.1, -0.1, 0.98), NOW).state; // back to baseline
    expect(s.fallActive).toBe(false);
    const second = ingestImu(MAP, s, imuPayload(2.0, 2.0, 0.3), NOW);
    expect(second.fall).not.toBeNull();
  });

  it('derives movement_rate from accel when the field is absent', () => {
    const r = ingestImu(
      MAP,
      freshState(),
      { ax: 2, ay: 2, az: 0 }, // sqrt(8) ≈ 2.83 > 2.0
      NOW,
    );
    expect(r.fall).not.toBeNull();
  });
});

describe('ingestLocation', () => {
  it('passes BLE RSSI samples through to signals.ble[]', () => {
    const r = ingestLocation(
      MAP,
      {
        ble: [
          { mac: 'AA:BB:CC:DD:EE:01', rssi: -62 },
          { mac: 'AA:BB:CC:DD:EE:02', rssi: -71 },
        ],
      },
      NOW,
    );
    expect(r.error).toBeUndefined();
    expect(r.signals?.ble).toHaveLength(2);
    expect(r.signals?.ble[0]).toEqual({ mac: 'AA:BB:CC:DD:EE:01', rssi: -62 });
  });

  it('synthesises beacon RSSI from a normalised [0,1] walk {x,y}', () => {
    const r = ingestLocation(MAP, { x: 0.5, y: 0.5 }, NOW); // mid-room
    expect(r.skipReason).toBeUndefined();
    expect(r.signals?.ble).toHaveLength(4); // one per fixture beacon (4 corners)
    for (const sample of r.signals?.ble ?? []) {
      expect(sample.mac).toMatch(/^AA:BB:CC:DD:EE:0[1-4]$/);
      expect(sample.rssi).toBeGreaterThanOrEqual(-99);
      expect(sample.rssi).toBeLessThanOrEqual(-40);
    }
  });

  it('maps the walk onto the placed-beacon box (corner reads strongest there)', () => {
    // Fixture beacon 1 is the NW corner → normalised (0,0) sits on it.
    const r = ingestLocation(MAP, { x: 0.02, y: 0.02 }, NOW);
    const ble = r.signals?.ble ?? [];
    const near = ble.find((s) => s.mac === 'AA:BB:CC:DD:EE:01')?.rssi ?? -200;
    const far = ble.find((s) => s.mac === 'AA:BB:CC:DD:EE:02')?.rssi ?? -200;
    expect(near).toBeGreaterThan(far);
  });

  it('synthesises against a supplied (DB-fetched) beacon layout, not the fixture', () => {
    // Custom layout: beacon X at the top-left, Y at the bottom-right of a 1000x600
    // room. Standing near X should read X strongest.
    const synth: SynthContext = {
      scale: 0.04,
      beacons: [
        { mac: 'X', x: 0, y: 0, rssi1m: -65 },
        { mac: 'Y', x: 1000, y: 600, rssi1m: -65 },
        { mac: 'Z', x: 0, y: 600, rssi1m: -65 },
      ],
    };
    const r = ingestLocation(MAP, { x: 0.05, y: 0.05 }, NOW, synth);
    const ble = r.signals?.ble ?? [];
    expect(ble.map((s) => s.mac).sort()).toEqual(['X', 'Y', 'Z']);
    const x = ble.find((s) => s.mac === 'X')?.rssi ?? -200;
    const y = ble.find((s) => s.mac === 'Y')?.rssi ?? -200;
    expect(x).toBeGreaterThan(y);
  });

  it('skips an empty payload (no ble, no x,y)', () => {
    const r = ingestLocation(MAP, {}, NOW);
    expect(r.signals).toBeNull();
    expect(r.skipReason).toMatch(/no usable/);
  });

  it('drops malformed ble entries (missing mac / non-finite rssi)', () => {
    const r = ingestLocation(
      MAP,
      {
        ble: [
          { mac: '', rssi: -60 },
          { mac: 'AA:BB:CC:DD:EE:03', rssi: 'x' },
        ],
      },
      NOW,
    );
    expect(r.signals).toBeNull();
  });
});
