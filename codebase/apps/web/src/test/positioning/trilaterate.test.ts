import { describe, it, expect } from 'vitest';
import { trilaterate } from '@alzcare/shared/positioning';
import type { BeaconDistance } from '@alzcare/shared/positioning';

/** Seeded LCG for deterministic noise (same pattern F7's aggregator
 *  test uses). */
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

/** Build three beacon-distance observations for a known patient
 *  position, an arbitrary set of beacon canvas coords, and a known
 *  scale. Distances are exact (no noise) unless the caller adds it. */
function distancesFor(
  patient: { x: number; y: number },
  beacons: { id: string; x: number; y: number }[],
  scaleMetersPerPixel: number,
  rssiByIdx: number[] = [],
): BeaconDistance[] {
  return beacons.map((b, i) => {
    const dx = b.x - patient.x;
    const dy = b.y - patient.y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);
    return {
      beacon_id: b.id,
      x_canvas: b.x,
      y_canvas: b.y,
      rssi: rssiByIdx[i] ?? -50 - i, // distinct RSSI so the top-3 sort is deterministic
      distance_m: distancePx * scaleMetersPerPixel,
    };
  });
}

const SCALE = 0.02; // 50 px / m — typical canvas calibration

describe('trilaterate', () => {
  it('recovers the centroid of an equilateral triangle (side 4 m) within 0.1 m', () => {
    // Three beacons at the corners of an equilateral triangle 4 m on a side.
    // 4 m / 0.02 mppx = 200 px sides.
    const sidePx = 4 / SCALE;
    const h = (Math.sqrt(3) / 2) * sidePx;
    const beacons = [
      { id: 'b-1', x: 0, y: 0 },
      { id: 'b-2', x: sidePx, y: 0 },
      { id: 'b-3', x: sidePx / 2, y: h },
    ];
    const truth = { x: sidePx / 2, y: h / 3 };
    const result = trilaterate(distancesFor(truth, beacons, SCALE), SCALE);
    expect(result).not.toBeNull();
    const errPx = Math.hypot(result!.x_canvas - truth.x, result!.y_canvas - truth.y);
    const errM = errPx * SCALE;
    expect(errM).toBeLessThan(0.1);
    expect(result!.residual_m).toBeLessThan(0.01);
  });

  it('recovers a right-triangle setup within 0.1 m', () => {
    const beacons = [
      { id: 'b-1', x: 0, y: 0 },
      { id: 'b-2', x: 200, y: 0 },
      { id: 'b-3', x: 0, y: 200 },
    ];
    const truth = { x: 80, y: 60 };
    const result = trilaterate(distancesFor(truth, beacons, SCALE), SCALE);
    expect(result).not.toBeNull();
    const errM = Math.hypot(result!.x_canvas - truth.x, result!.y_canvas - truth.y) * SCALE;
    expect(errM).toBeLessThan(0.1);
  });

  it('with realistic distance noise, average recovery error stays under 1 m over 100 trials', () => {
    // RSSI noise of ~1 dB at exponent 2.0 corresponds to ~12% distance
    // error per beacon. Across 100 seeded trials we expect the mean
    // recovery error to sit well under the F8 1.5 m / 80% target —
    // this is a regression test on the solver, not a tuned-pass-fail
    // single seed.
    const beacons = [
      { id: 'b-1', x: 0, y: 0 },
      { id: 'b-2', x: 250, y: 0 },
      { id: 'b-3', x: 125, y: 220 },
    ];
    const truth = { x: 130, y: 80 };
    const errors: number[] = [];
    for (let seed = 1; seed <= 100; seed++) {
      const rand = rng(seed);
      const clean = distancesFor(truth, beacons, SCALE);
      const noisy: BeaconDistance[] = clean.map((d) => ({
        ...d,
        distance_m: Math.max(0.1, d.distance_m * (1 + gaussian(rand, 0, 0.06))),
      }));
      const result = trilaterate(noisy, SCALE);
      if (result == null) continue;
      const errM = Math.hypot(result.x_canvas - truth.x, result.y_canvas - truth.y) * SCALE;
      errors.push(errM);
    }
    // Should solve almost every trial; very few rejections.
    expect(errors.length).toBeGreaterThan(95);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mean).toBeLessThan(1.0);
    // 80th percentile under the F8 target.
    const sorted = [...errors].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!;
    expect(p80).toBeLessThan(1.5);
  });

  it('returns null when fewer than 3 beacon distances supplied', () => {
    expect(trilaterate([], SCALE)).toBeNull();
    const two: BeaconDistance[] = [
      { beacon_id: 'b-1', x_canvas: 0, y_canvas: 0, rssi: -50, distance_m: 1 },
      { beacon_id: 'b-2', x_canvas: 100, y_canvas: 0, rssi: -55, distance_m: 1 },
    ];
    expect(trilaterate(two, SCALE)).toBeNull();
  });

  it('rejects colinear beacon arrangements', () => {
    const beacons = [
      { id: 'b-1', x: 0, y: 100 },
      { id: 'b-2', x: 100, y: 100 },
      { id: 'b-3', x: 200, y: 100 }, // exactly on the same y line
    ];
    const distances = distancesFor({ x: 100, y: 200 }, beacons, SCALE);
    expect(trilaterate(distances, SCALE)).toBeNull();
  });

  it('rejects geometrically inconsistent inputs (residual > 5 m)', () => {
    // Three beacons in a triangle, but the supplied distances claim the
    // patient is impossibly far from all of them. The least-squares
    // best-fit will have a large residual.
    const beacons = [
      { id: 'b-1', x: 0, y: 0 },
      { id: 'b-2', x: 200, y: 0 },
      { id: 'b-3', x: 100, y: 173 },
    ];
    const wild: BeaconDistance[] = beacons.map((b, i) => ({
      beacon_id: b.id,
      x_canvas: b.x,
      y_canvas: b.y,
      rssi: -50 - i,
      distance_m: 100, // every beacon claims 100 m — impossible inside a 4-m triangle
    }));
    expect(trilaterate(wild, SCALE)).toBeNull();
  });

  it('takes the strongest 3 beacons by RSSI when more than 3 are supplied', () => {
    const beacons = [
      { id: 'strong-1', x: 0, y: 0, rssi: -50 },
      { id: 'strong-2', x: 200, y: 0, rssi: -55 },
      { id: 'strong-3', x: 100, y: 173, rssi: -60 },
      { id: 'weak', x: 1000, y: 1000, rssi: -90 }, // far away, weak — should be excluded
    ];
    const truth = { x: 100, y: 60 };
    // Construct distances from truth for the three strong beacons; weak
    // beacon gets a deliberately wrong distance.
    const distances: BeaconDistance[] = beacons.map((b) => {
      const ideal = Math.hypot(b.x - truth.x, b.y - truth.y) * SCALE;
      return {
        beacon_id: b.id,
        x_canvas: b.x,
        y_canvas: b.y,
        rssi: b.rssi,
        distance_m: b.id === 'weak' ? 0.001 : ideal, // weak claims 1 mm — would wreck the solve if included
      };
    });
    const result = trilaterate(distances, SCALE);
    expect(result).not.toBeNull();
    const errM = Math.hypot(result!.x_canvas - truth.x, result!.y_canvas - truth.y) * SCALE;
    expect(errM).toBeLessThan(0.1);
  });

  it('returns null when scaleMetersPerPixel is invalid', () => {
    const beacons = [
      { id: 'b-1', x: 0, y: 0 },
      { id: 'b-2', x: 200, y: 0 },
      { id: 'b-3', x: 100, y: 173 },
    ];
    const distances = distancesFor({ x: 100, y: 60 }, beacons, SCALE);
    expect(trilaterate(distances, 0)).toBeNull();
    expect(trilaterate(distances, -0.01)).toBeNull();
    expect(trilaterate(distances, Number.NaN)).toBeNull();
  });
});
