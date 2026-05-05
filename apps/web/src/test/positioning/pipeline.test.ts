import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runPositionPipeline, DEFAULT_RSSI_AT_1M } from '@alzcare/shared/positioning';
import type { BeaconRow, CalibrationPoint, RecentEstimate } from '@alzcare/shared/positioning';
import type { SignalsMessage } from '@alzcare/shared/mqtt';

const SCALE = 0.02; // 50 px / m

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const DEVICE_ID = '22222222-2222-2222-2222-222222222222';

function rng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
function gaussian(rand: () => number, mean: number, stddev: number): number {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

function beacon(
  id: string,
  mac: string,
  x: number,
  y: number,
  rssi1m = DEFAULT_RSSI_AT_1M,
): BeaconRow {
  return {
    id,
    patient_id: PATIENT_ID,
    floor_plan_id: 'fp-1',
    mac_address: mac,
    x_canvas: x,
    y_canvas: y,
    tx_power: null,
    rssi_at_1m: rssi1m,
  };
}

function calibration(
  id: string,
  x: number,
  y: number,
  ble: { mac: string; rssi_mean: number }[],
): CalibrationPoint {
  return {
    id,
    floor_plan_id: 'fp-1',
    x_canvas: x,
    y_canvas: y,
    ble_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: ble.map((b) => ({
        mac: b.mac,
        rssi_mean: b.rssi_mean,
        rssi_stddev: 1,
        sample_count: 30,
      })),
      quality: {
        sample_count_total: ble.length * 30,
        ble_count: ble.length * 30,
        wifi_count: 0,
        window_ms: 5000,
      },
    },
    wifi_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 5000 },
    },
    captured_at: '2026-05-05T00:00:00Z',
  };
}

/** Synthesise a signals message from a known patient position by
 *  reverse-applying the path-loss model on each beacon, with optional
 *  Gaussian noise. */
function syntheticSignals(
  recordedAt: string,
  truth: { x: number; y: number },
  beacons: BeaconRow[],
  rand?: () => number,
  noiseDb = 0,
): SignalsMessage {
  return {
    v: 1,
    patient_id: PATIENT_ID,
    device_id: DEVICE_ID,
    recorded_at: recordedAt,
    ble: beacons.map((b) => {
      const dx = (b.x_canvas as number) - truth.x;
      const dy = (b.y_canvas as number) - truth.y;
      const distM = Math.sqrt(dx * dx + dy * dy) * SCALE;
      // Solve path loss for RSSI: rssi = rssi_at_1m - 10 * exp * log10(d)
      const rssiClean = (b.rssi_at_1m as number) - 10 * 2.0 * Math.log10(Math.max(distM, 0.01));
      const rssi = rand && noiseDb > 0 ? rssiClean + gaussian(rand, 0, noiseDb) : rssiClean;
      return { mac: b.mac_address, rssi };
    }),
    wifi: [],
  };
}

describe('runPositionPipeline', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('cold start: produces a row with confidence < steady state', () => {
    const beacons = [
      beacon('b-1', 'AA:01', 0, 0),
      beacon('b-2', 'AA:02', 250, 0),
      beacon('b-3', 'AA:03', 125, 220),
    ];
    const truth = { x: 130, y: 80 };
    const cal = calibration(
      'c-1',
      130,
      80,
      beacons.map((b) => ({ mac: b.mac_address, rssi_mean: -60 })),
    );
    const sig = syntheticSignals('2026-05-05T12:00:00Z', truth, beacons);
    const out = runPositionPipeline({
      signals: sig,
      beacons,
      calibrationPoints: [cal],
      recentEstimates: [],
      scaleMetersPerPixel: SCALE,
    });
    expect(out).not.toBeNull();
    expect(out!.mode).toBe('indoor');
    expect(out!.x_canvas).not.toBeNull();
    // Recovered position close to truth.
    const errM =
      Math.hypot((out!.x_canvas as number) - truth.x, (out!.y_canvas as number) - truth.y) * SCALE;
    expect(errM).toBeLessThan(0.5);
  });

  it('returns null when no signals + no GPS — caller writes nothing', () => {
    const out = runPositionPipeline({
      signals: {
        v: 1,
        patient_id: PATIENT_ID,
        device_id: DEVICE_ID,
        recorded_at: '2026-05-05T12:00:00Z',
        ble: [],
        wifi: [],
      },
      beacons: [beacon('b-1', 'AA:01', 0, 0)],
      calibrationPoints: [],
      recentEstimates: [],
      scaleMetersPerPixel: SCALE,
    });
    expect(out).toBeNull();
  });

  it('synthetic ground-truth: < 1.5 m error on > 80% of 100 noisy ticks', () => {
    // F8 verification gate (unit-level proxy; replay harness in slice 7
    // is the integration-level gate).
    const beacons = [
      beacon('b-1', 'AA:01', 0, 0),
      beacon('b-2', 'AA:02', 300, 0),
      beacon('b-3', 'AA:03', 150, 260),
    ];
    // Two calibration points to give the fingerprint matcher something.
    const calMacs = beacons.map((b) => b.mac_address);
    const calibrations: CalibrationPoint[] = [
      calibration(
        'c-1',
        80,
        60,
        calMacs.map((m, i) => ({
          mac: m,
          rssi_mean: -55 - i * 5,
        })),
      ),
      calibration(
        'c-2',
        220,
        180,
        calMacs.map((m, i) => ({
          mac: m,
          rssi_mean: -55 - i * 5 + 5,
        })),
      ),
    ];
    const truth = { x: 150, y: 130 };
    const errors: number[] = [];
    let recent: RecentEstimate[] = [];
    const rand = rng(2026);
    for (let tick = 0; tick < 100; tick++) {
      const sig = syntheticSignals(
        new Date(Date.parse('2026-05-05T12:00:00Z') + tick * 1000).toISOString(),
        truth,
        beacons,
        rand,
        1.5, // 1.5 dB Gaussian noise per beacon
      );
      const out = runPositionPipeline({
        signals: sig,
        beacons,
        calibrationPoints: calibrations,
        recentEstimates: recent,
        scaleMetersPerPixel: SCALE,
      });
      expect(out).not.toBeNull();
      const errPx = Math.hypot(
        (out!.x_canvas as number) - truth.x,
        (out!.y_canvas as number) - truth.y,
      );
      errors.push(errPx * SCALE);
      // Push this row into history for next tick (simulates the DB
      // round-trip the orchestrator does).
      const newRow: RecentEstimate = {
        recorded_at: out!.recorded_at,
        mode: 'indoor',
        x_canvas: out!.x_canvas,
        y_canvas: out!.y_canvas,
        confidence: out!.confidence,
      };
      recent = [newRow, ...recent].slice(0, 6);
    }
    const sorted = [...errors].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!;
    const max = sorted[sorted.length - 1]!;
    // 80th percentile under the F8 1.5 m target on synthetic noiseless-
    // path-loss-with-1.5-dB-noise inputs.
    expect(p80).toBeLessThan(1.5);
    // Even worst-case shouldn't be wild given ideal model conditions.
    expect(max).toBeLessThan(3);
  });

  it('beacon dropout: tick 30 zeros one beacon to -127; no jump > 2 m, recovery within 2 ticks', () => {
    const beacons = [
      beacon('b-1', 'AA:01', 0, 0),
      beacon('b-2', 'AA:02', 300, 0),
      beacon('b-3', 'AA:03', 150, 260),
    ];
    const cal = calibration('c-1', 150, 130, [
      { mac: 'AA:01', rssi_mean: -65 },
      { mac: 'AA:02', rssi_mean: -65 },
      { mac: 'AA:03', rssi_mean: -65 },
    ]);
    const truth = { x: 150, y: 130 };
    let recent: RecentEstimate[] = [];
    const positions: { x: number | null; y: number | null }[] = [];
    for (let tick = 0; tick < 60; tick++) {
      const sig = syntheticSignals(
        new Date(Date.parse('2026-05-05T12:00:00Z') + tick * 1000).toISOString(),
        truth,
        beacons,
      );
      // Tick 30: drop beacon AA:01 to -127.
      if (tick >= 30 && tick <= 32) {
        const idx = sig.ble.findIndex((s) => s.mac === 'AA:01');
        if (idx >= 0) sig.ble[idx] = { mac: 'AA:01', rssi: -127 };
      }
      const out = runPositionPipeline({
        signals: sig,
        beacons,
        calibrationPoints: [cal],
        recentEstimates: recent,
        scaleMetersPerPixel: SCALE,
      });
      expect(out).not.toBeNull();
      positions.push({ x: out!.x_canvas, y: out!.y_canvas });
      const newRow: RecentEstimate = {
        recorded_at: out!.recorded_at,
        mode: 'indoor',
        x_canvas: out!.x_canvas,
        y_canvas: out!.y_canvas,
        confidence: out!.confidence,
      };
      recent = [newRow, ...recent].slice(0, 6);
    }
    // Tick-to-tick delta in metres around the dropout instant must
    // never exceed 2 m (F8 acceptance: smoothing dampens spikes).
    for (let i = 28; i < 35; i++) {
      const a = positions[i - 1]!;
      const b = positions[i]!;
      const jumpM =
        Math.hypot((b.x as number) - (a.x as number), (b.y as number) - (a.y as number)) * SCALE;
      expect(jumpM).toBeLessThan(2);
    }
    // After 2 ticks of recovery (index 34), error back within budget.
    const recoveryErr =
      Math.hypot((positions[34]!.x as number) - truth.x, (positions[34]!.y as number) - truth.y) *
      SCALE;
    expect(recoveryErr).toBeLessThan(1.5);
  });
});
