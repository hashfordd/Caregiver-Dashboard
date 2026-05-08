// F8 stage 2: trilateration over the top-3 strongest BLE beacons.
//
// Mathematics: each beacon is a circle in canvas-pixel space with
// radius = distance_m / scaleMetersPerPixel. The patient lies at the
// intersection of the three circles. With perfect measurements the
// circles meet at one point; with noise we want the least-squares
// best-fit point.
//
// Reduction: subtract circle 1's equation from circles 2 and 3. The
// quadratic terms cancel and we're left with two linear equations in
// (x, y) — solvable as a 2×2 system via Cramer's rule. Returns the
// recovered position plus the RMS residual of the three measured
// distances against the recovered point's actual distances; the fusion
// stage uses the residual to weight trilateration vs. fingerprinting.
//
// Pure function. No globals, no logging.
//
// Phase G item 59: the colinearity threshold is now expressed in
// real-world m² and converted to pixels² at solve time, so a
// 100 px/m floor plan and a 25 px/m floor plan reject the same
// geometric arrangements. Previously the fixed 1 px² constant
// over-rejected on dense canvases and under-rejected on sparse ones.

import type { BeaconDistance, TrilaterationResult } from './types.ts';

/** Minimum triangle area (real-world m²) before the three beacons are
 *  considered colinear and the solve is rejected. 4 cm² (0.04 m × 0.1 m
 *  triangle base × height) gives a hard floor on geometric quality
 *  regardless of canvas scale. The check converts this to canvas-px²
 *  using `scaleMetersPerPixel` at solve time. */
const COLINEARITY_EPSILON_M2 = 4e-4;

/** Reject solutions whose RMS residual exceeds this many metres. A
 *  residual that high means the three measured distances can't be
 *  satisfied by any point — typical of NLOS, body shadowing, or a
 *  miscalibrated beacon. The fusion stage falls back to fingerprint-
 *  only in that case. */
const MAX_ACCEPTABLE_RESIDUAL_M = 5.0;

/** Solve for the patient's canvas position from beacon distances.
 *
 *  Picks the top 3 by RSSI (strongest signal = lowest distance noise).
 *  Returns null when:
 *   - Fewer than 3 beacon distances supplied.
 *   - The chosen 3 are colinear (degenerate triangle).
 *   - The least-squares fit is geometrically inconsistent (residual
 *     exceeds MAX_ACCEPTABLE_RESIDUAL_M).
 *
 *  scaleMetersPerPixel converts measured distances (metres) to canvas
 *  units for the solve, and the residual back to metres for the return. */
export function trilaterate(
  beaconDistances: BeaconDistance[],
  scaleMetersPerPixel: number,
): TrilaterationResult | null {
  if (beaconDistances.length < 3) return null;
  if (!Number.isFinite(scaleMetersPerPixel) || scaleMetersPerPixel <= 0) return null;

  // Top 3 by RSSI (highest = strongest = lowest distance noise).
  const top3 = [...beaconDistances].sort((a, b) => b.rssi - a.rssi).slice(0, 3);
  const [b1, b2, b3] = top3 as [BeaconDistance, BeaconDistance, BeaconDistance];

  // Reject colinear arrangements via signed triangle area. The
  // threshold is fixed in real-world m² and converted to px² so
  // canvases with different scales reject the same physical
  // arrangements (item 59).
  const epsilonPx2 = COLINEARITY_EPSILON_M2 / (scaleMetersPerPixel * scaleMetersPerPixel);
  const area2 = Math.abs(
    b1.x_canvas * (b2.y_canvas - b3.y_canvas) +
      b2.x_canvas * (b3.y_canvas - b1.y_canvas) +
      b3.x_canvas * (b1.y_canvas - b2.y_canvas),
  );
  if (area2 / 2 < epsilonPx2) return null;

  // Convert distances to canvas pixels for the solve.
  const r1 = b1.distance_m / scaleMetersPerPixel;
  const r2 = b2.distance_m / scaleMetersPerPixel;
  const r3 = b3.distance_m / scaleMetersPerPixel;

  // Subtract circle 1 from circles 2 and 3 to get a 2×2 linear system:
  //   2(x2-x1) x + 2(y2-y1) y = r1² - r2² + (x2² + y2²) - (x1² + y1²)
  //   2(x3-x1) x + 2(y3-y1) y = r1² - r3² + (x3² + y3²) - (x1² + y1²)
  const A11 = 2 * (b2.x_canvas - b1.x_canvas);
  const A12 = 2 * (b2.y_canvas - b1.y_canvas);
  const A21 = 2 * (b3.x_canvas - b1.x_canvas);
  const A22 = 2 * (b3.y_canvas - b1.y_canvas);

  const sq1 = b1.x_canvas * b1.x_canvas + b1.y_canvas * b1.y_canvas;
  const sq2 = b2.x_canvas * b2.x_canvas + b2.y_canvas * b2.y_canvas;
  const sq3 = b3.x_canvas * b3.x_canvas + b3.y_canvas * b3.y_canvas;

  const B1 = r1 * r1 - r2 * r2 + sq2 - sq1;
  const B2 = r1 * r1 - r3 * r3 + sq3 - sq1;

  // Cramer's rule: det must be nonzero (the colinearity check above
  // already enforces this, but guard against floating-point edges).
  const det = A11 * A22 - A12 * A21;
  if (Math.abs(det) < 1e-9) return null;

  const x = (B1 * A22 - B2 * A12) / det;
  const y = (A11 * B2 - A21 * B1) / det;

  // Residual: compare each beacon's measured distance to its actual
  // distance from the recovered point. Convert back to metres.
  const errs = top3.map((b) => {
    const dx = x - b.x_canvas;
    const dy = y - b.y_canvas;
    const actualPx = Math.sqrt(dx * dx + dy * dy);
    const actualM = actualPx * scaleMetersPerPixel;
    return actualM - b.distance_m;
  });
  const rms = Math.sqrt(errs.reduce((acc, e) => acc + e * e, 0) / errs.length);

  if (rms > MAX_ACCEPTABLE_RESIDUAL_M) return null;

  return { x_canvas: x, y_canvas: y, residual_m: rms };
}
