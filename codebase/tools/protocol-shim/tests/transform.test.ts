import { describe, it, expect } from 'vitest';
import {
  freshState,
  ingestHeartRate,
  ingestImu,
  ingestLocation,
  ingestTotal,
  G_MPS2,
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
    // allowSynth must be true — without it the x,y path is disabled by design.
    const r = ingestLocation(MAP, { x: 0.5, y: 0.5 }, NOW, undefined, true); // mid-room
    expect(r.skipReason).toBeUndefined();
    expect(r.signals?.ble).toHaveLength(4); // one per fixture beacon (4 corners)
    for (const sample of r.signals?.ble ?? []) {
      expect(sample.mac).toMatch(/^AA:BB:CC:DD:EE:0[1-4]$/);
      expect(sample.rssi).toBeGreaterThanOrEqual(-99);
      expect(sample.rssi).toBeLessThanOrEqual(-40);
    }
  });

  it('does NOT synthesise when allowSynth is false (default)', () => {
    // An x,y walk without the flag set must produce no signals — the dot holds
    // last-known rather than getting fabricated RSSI.
    const r = ingestLocation(MAP, { x: 0.5, y: 0.5 }, NOW); // allowSynth defaults false
    expect(r.signals).toBeNull();
    expect(r.skipReason).toMatch(/no usable/);
  });

  it('maps the walk onto the placed-beacon box (corner reads strongest there)', () => {
    // Fixture beacon 1 is the NW corner → normalised (0,0) sits on it.
    const r = ingestLocation(MAP, { x: 0.02, y: 0.02 }, NOW, undefined, true);
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
    const r = ingestLocation(MAP, { x: 0.05, y: 0.05 }, NOW, synth, true);
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

// Mirrors the real device's combined `alzcare/{site}/patient{n}/total` payload
// (acceleration in m/s², measured BLE RSSI per beacon, status-gated sources).
const totalPayload = (over: Record<string, unknown> = {}) => ({
  patient_id: '001',
  gps_status: 'INVALID',
  latitude: 0,
  longitude: 0,
  satellites: 0,
  heart_rate_status: 'VALID',
  finger_status: 'DETECTED',
  ir_value: 102375,
  bpm: 82.4,
  avg_bpm: 80,
  imu_status: 'VALID',
  acc_x_mps2: 0.2,
  acc_y_mps2: -0.1,
  acc_z_mps2: 9.78, // ~1 g at rest
  gyro_x_dps: 1.562,
  gyro_y_dps: -7.734,
  gyro_z_dps: -1.391,
  ble_status: 'SCANNING',
  ble_company_filter: '0x0505',
  ble_device_count: 2,
  ble_devices: [
    { mac_address: '06:05:04:03:02:21', rssi: -72, battery_percent: 58 },
    { mac_address: '06:05:04:03:02:31', rssi: -81, battery_percent: 68 },
  ],
  ...over,
});

describe('ingestTotal — combined device payload', () => {
  it('fans one packet out into telemetry + signals (no fall at rest)', () => {
    const r = ingestTotal(MAP, freshState(), totalPayload(), NOW);
    expect(r.errors).toEqual([]);

    // Telemetry: avg_bpm preferred, accel converted m/s² → g, gyro forwarded.
    expect(r.telemetry).toMatchObject({ v: 1, patient_id: MAP.patient_id, hr_bpm: 80 });
    expect(r.telemetry?.accel?.z).toBeCloseTo(9.78 / G_MPS2, 3); // ~0.997 g, not 9.78
    expect(r.telemetry?.gyro).toEqual({ x: 1.562, y: -7.734, z: -1.391 });

    // Signals: measured BLE passed straight through (no synthesis).
    expect(r.signals?.ble).toEqual([
      { mac: '06:05:04:03:02:21', rssi: -72, battery_pct: 58 },
      { mac: '06:05:04:03:02:31', rssi: -81, battery_pct: 68 },
    ]);
    expect(r.signals?.gps).toBeUndefined(); // gps_status INVALID

    expect(r.fall).toBeNull();
    expect(r.state.fallActive).toBe(false);
  });

  it('does NOT trip the fall latch on a 1 g rest reading (m/s² → g guard)', () => {
    // Regression: feeding raw m/s² (~9.8) into a g-calibrated latch would fire.
    const r = ingestTotal(MAP, freshState(), totalPayload(), NOW);
    expect(r.fall).toBeNull();
  });

  it('fires one fall on a movement spike with gyro corroboration, then latches', () => {
    // ~3 g impact (sqrt(20²+20²+5²)/g ≈ 2.96 > IMPACT_HIGH_G) with rapid rotation
    // (≈200 dps) satisfying gyro corroboration. Both gates must pass under the new
    // balanced algorithm (raised threshold + gyro check).
    const spike = totalPayload({
      acc_x_mps2: 20,
      acc_y_mps2: 20,
      acc_z_mps2: 5,
      gyro_x_dps: 141,
      gyro_y_dps: 141,
      gyro_z_dps: 0, // hypot ≈ 199 dps > GYRO_IMPACT_DPS (150)
    });
    const first = ingestTotal(MAP, freshState(), spike, NOW);
    expect(first.fall).toMatchObject({ v: 1, type: 'fall', patient_id: MAP.patient_id });
    const mr = (first.fall?.payload as { movement_rate: number }).movement_rate;
    expect(mr).toBeGreaterThan(MOVEMENT_HIGH);

    const second = ingestTotal(MAP, first.state, spike, NOW);
    expect(second.fall).toBeNull(); // suppressed while still down
  });

  it('falls back to instantaneous bpm when avg_bpm is 0', () => {
    const r = ingestTotal(MAP, freshState(), totalPayload({ avg_bpm: 0, bpm: 77 }), NOW);
    expect(r.telemetry?.hr_bpm).toBe(77);
  });

  it('omits hr_bpm when the finger is not detected, but still forwards accel', () => {
    const r = ingestTotal(MAP, freshState(), totalPayload({ finger_status: 'LOST' }), NOW);
    expect(r.telemetry?.hr_bpm).toBeUndefined();
    expect(r.telemetry?.accel).toBeDefined();
  });

  it('drops the IMU entirely when imu_status is not VALID', () => {
    const r = ingestTotal(MAP, freshState(), totalPayload({ imu_status: 'INVALID' }), NOW);
    expect(r.telemetry?.accel).toBeUndefined();
    expect(r.telemetry?.gyro).toBeUndefined();
    expect(r.telemetry?.hr_bpm).toBe(80); // HR still forwarded
    expect(r.fall).toBeNull();
  });

  it('includes gps only when gps_status is VALID', () => {
    const r = ingestTotal(
      MAP,
      freshState(),
      totalPayload({ gps_status: 'VALID', latitude: -37.8136, longitude: 144.9631 }),
      NOW,
    );
    expect(r.signals?.gps).toEqual({ lat: -37.8136, lng: 144.9631 });
  });

  it('filters unusable beacons but keeps the good ones', () => {
    const r = ingestTotal(
      MAP,
      freshState(),
      totalPayload({
        ble_devices: [
          { mac_address: '', rssi: -60 },
          { mac_address: '06:05:04:03:02:41', rssi: 'x' },
          { mac_address: '06:05:04:03:02:51', rssi: -65 },
        ],
      }),
      NOW,
    );
    expect(r.signals?.ble).toEqual([{ mac: '06:05:04:03:02:51', rssi: -65 }]);
  });

  it('emits no signals when there are no beacons and no gps fix', () => {
    const r = ingestTotal(MAP, freshState(), totalPayload({ ble_devices: [] }), NOW);
    expect(r.signals).toBeNull();
    expect(r.telemetry).not.toBeNull(); // telemetry still flows
  });
});
