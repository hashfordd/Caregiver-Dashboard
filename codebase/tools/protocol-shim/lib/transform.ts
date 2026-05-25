// Pure transforms from the hardware prototype's raw payloads to the canonical
// MQTT messages. Extracted from index.ts so the mapping + fall-latch logic can
// be unit-tested without the MQTT/Supabase side effects of main(). A regression
// here silently corrupts every reading the shim forwards, so it is the
// load-bearing surface to keep under test.

import { TelemetryMessage, SignalsMessage, EventMessage, type Vec3 } from '@alzcare/shared';
import { LIVE_TEST_BEACONS, LIVE_TEST_SCALE_M_PER_PX } from '@alzcare/shared/fixtures';

export interface Mapping {
  /** patient UUID — FK target for sensor_readings / events. */
  patient_id: string;
  /** device UUID — FK target. */
  device_id: string;
}

/** Per-patient rolling state: latest cached vitals + the fall latch. */
export interface ShimState {
  hr: number | null;
  accel: Vec3 | null;
  fallActive: boolean;
}

export function freshState(): ShimState {
  return { hr: null, accel: null, fallActive: false };
}

// Fall-detection thresholds, ported from D2-Processor.py. movement_rate is the
// IMU's sqrt(ax² + ay² + az²); a spike past MOVEMENT_HIGH is a fall impact. The
// reset gate adds hysteresis so one fall emits one event, not one per tick the
// patient stays down.
export const MOVEMENT_HIGH = 2.0;
export const MOVEMENT_RESET = 1.2;

function num(v: unknown): number {
  return Number(v);
}

/**
 * Ingest a `raw/heartrate` payload. Caches HR and emits a TelemetryMessage,
 * merging the latest cached IMU accel. Telemetry is HR-triggered so each
 * message carries a real heart-rate sample.
 */
export function ingestHeartRate(
  map: Mapping,
  state: ShimState,
  payload: Record<string, unknown>,
  nowIso: string,
): { state: ShimState; telemetry: TelemetryMessage | null; error?: string } {
  const value = num(payload.value);
  if (!Number.isFinite(value)) {
    return { state, telemetry: null, error: 'heartrate.value is not finite' };
  }
  const next: ShimState = { ...state, hr: value };

  // SpO2 / temperature are optional vitals the prototype now also emits
  // (display + future integration). Forwarded only when present + finite.
  const spo2 = num(payload.spo2);
  const temp = num(payload.temp_c);
  const candidate = {
    v: 1 as const,
    patient_id: map.patient_id,
    device_id: map.device_id,
    recorded_at: nowIso,
    hr_bpm: value,
    ...(Number.isFinite(spo2) ? { spo2_pct: spo2 } : {}),
    ...(Number.isFinite(temp) ? { temp_c: temp } : {}),
    ...(next.accel ? { accel: next.accel } : {}),
    fw_version: 'shim-1.0.0',
  };
  const parsed = TelemetryMessage.safeParse(candidate);
  if (!parsed.success) {
    return { state: next, telemetry: null, error: parsed.error.issues[0]?.message };
  }
  return { state: next, telemetry: parsed.data };
}

/**
 * Ingest a `raw/imu` payload. Updates the cached accel vector and runs the
 * rising-edge fall latch. Returns a fall EventMessage only on the transition
 * into a fall; subsequent spikes are suppressed until movement normalises.
 */
export function ingestImu(
  map: Mapping,
  state: ShimState,
  payload: Record<string, unknown>,
  nowIso: string,
): { state: ShimState; fall: EventMessage | null; error?: string } {
  const ax = num(payload.ax);
  const ay = num(payload.ay);
  const az = num(payload.az);

  const next: ShimState = { ...state };
  if (Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az)) {
    next.accel = { x: ax, y: ay, z: az };
  }

  // Prefer the IMU's published movement_rate; derive it from the accel vector
  // when absent (same formula the prototype's buildIMU uses).
  const movement = Number.isFinite(num(payload.movement_rate))
    ? num(payload.movement_rate)
    : Math.sqrt(ax * ax + ay * ay + az * az);

  if (movement > MOVEMENT_HIGH && !next.fallActive) {
    next.fallActive = true;
    const tilt = num(payload.tilt);
    const candidate = {
      v: 1 as const,
      patient_id: map.patient_id,
      device_id: map.device_id,
      occurred_at: nowIso,
      type: 'fall' as const,
      payload: {
        movement_rate: movement,
        ...(Number.isFinite(tilt) ? { tilt } : {}),
      },
    };
    const parsed = EventMessage.safeParse(candidate);
    if (!parsed.success) {
      return { state: next, fall: null, error: parsed.error.issues[0]?.message };
    }
    return { state: next, fall: parsed.data };
  }

  if (movement <= MOVEMENT_RESET && next.fallActive) {
    next.fallActive = false; // movement normalised — re-arm for the next fall
  }
  return { state: next, fall: null };
}

// Forward path-loss model — the inverse of position_estimator's
// pathLossDistance (10^((rssi1m - rssi)/(10·exp))). Sim-only: real hardware
// reports measured RSSI directly.
const SYNTH_PATH_LOSS_EXPONENT = 2.0;

/** A placed beacon the walk is synthesised against (canvas coords + ref RSSI). */
export interface BeaconAnchor {
  mac: string;
  x: number;
  y: number;
  rssi1m: number;
}

/** Beacon geometry + scale the synthesiser trilaterates against. */
export interface SynthContext {
  beacons: BeaconAnchor[];
  /** metres per canvas pixel */
  scale: number;
}

/**
 * Default synthesis anchors from the shared fixture. Used only when the shim
 * can't fetch the real placed beacons (e.g. no service key) — accurate ONLY if
 * the DB beacons still sit at the fixture coords. The shim normally fetches the
 * live placements and passes them in, so the dot tracks regardless of where the
 * beacons are arranged in the Place editor.
 */
export const FIXTURE_SYNTH: SynthContext = {
  beacons: LIVE_TEST_BEACONS.map((b) => ({ mac: b.mac, x: b.x, y: b.y, rssi1m: -65 })),
  scale: LIVE_TEST_SCALE_M_PER_PX,
};

/** Synthesise per-beacon RSSI for a patient standing at canvas (x, y). */
function synthesizeBleFromXy(
  x: number,
  y: number,
  ctx: SynthContext,
): { mac: string; rssi: number }[] {
  return ctx.beacons.map((b) => {
    const distMeters = Math.max(Math.hypot(x - b.x, y - b.y) * ctx.scale, 0.5);
    const rssi = b.rssi1m - 10 * SYNTH_PATH_LOSS_EXPONENT * Math.log10(distMeters);
    // Clamp into a realistic BLE range (SignalsMessage allows -127..20).
    return { mac: b.mac, rssi: Math.round(Math.max(-99, Math.min(-40, rssi))) };
  });
}

/**
 * Map a NORMALISED [0,1] room coordinate onto the placed-beacon bounding box,
 * so the simulated walk covers wherever the beacons are arranged in the
 * software — no room geometry is assumed here.
 */
function normalizedToCanvas(
  nx: number,
  ny: number,
  beacons: BeaconAnchor[],
): { cx: number; cy: number } {
  const xs = beacons.map((b) => b.x);
  const ys = beacons.map((b) => b.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  return {
    cx: minX + clamp01(nx) * (maxX - minX),
    cy: minY + clamp01(ny) * (maxY - minY),
  };
}

/**
 * Ingest a `raw/location` payload into a SignalsMessage. Two sources:
 *  - Real hardware reports BLE RSSI (`ble: [{ mac, rssi }]`) → passed through.
 *  - The prototype SIMULATOR emits a NORMALISED [0,1] walk (`{x,y}`); we map it
 *    onto `synth` (the patient's software-placed beacons) and synthesise beacon
 *    RSSI (forward path-loss) so the indoor map dot tracks the patient via the
 *    real positioning pipeline — wherever the beacons are arranged.
 *
 * TODO(location-payload): confirm the real on-the-wire ble shape with hardware.
 */
export function ingestLocation(
  map: Mapping,
  payload: Record<string, unknown>,
  nowIso: string,
  synth: SynthContext = FIXTURE_SYNTH,
): { signals: SignalsMessage | null; skipReason?: string; error?: string } {
  let ble = Array.isArray(payload.ble)
    ? (payload.ble as unknown[])
        .map((b) => {
          const s = b as Record<string, unknown>;
          return { mac: String(s.mac ?? ''), rssi: num(s.rssi) };
        })
        .filter((b) => b.mac.length > 0 && Number.isFinite(b.rssi))
    : [];

  // No measured RSSI → derive it from a simulated normalised [0,1] walk mapped
  // onto the patient's placed beacons (the software-owned layout).
  if (
    ble.length === 0 &&
    synth.beacons.length > 0 &&
    Number.isFinite(num(payload.x)) &&
    Number.isFinite(num(payload.y))
  ) {
    const { cx, cy } = normalizedToCanvas(num(payload.x), num(payload.y), synth.beacons);
    ble = synthesizeBleFromXy(cx, cy, synth);
  }

  if (ble.length === 0) {
    return { signals: null, skipReason: 'no usable ble samples and no x,y to synthesise from' };
  }

  const wifi = Array.isArray(payload.wifi)
    ? (payload.wifi as unknown[]).map((w) => {
        const s = w as Record<string, unknown>;
        return {
          bssid: String(s.bssid ?? ''),
          rssi: num(s.rssi),
          ...(typeof s.ssid === 'string' ? { ssid: s.ssid } : {}),
        };
      })
    : [];

  const candidate = {
    v: 1 as const,
    patient_id: map.patient_id,
    device_id: map.device_id,
    recorded_at: nowIso,
    ble,
    wifi,
    ...(payload.gps ? { gps: payload.gps } : {}),
  };
  const parsed = SignalsMessage.safeParse(candidate);
  if (!parsed.success) {
    return { signals: null, error: parsed.error.issues[0]?.message };
  }
  return { signals: parsed.data };
}
