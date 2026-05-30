// F8 stage 2: weighted least-squares multilateration over ALL fresh BLE
// beacons, with leave-one-out outlier rejection.
//
// Mathematics: each beacon is a circle in canvas-pixel space with
// radius = distance_m / scaleMetersPerPixel. The patient lies near the
// common intersection; with noise we want the best-fit point. Subtracting
// the strongest beacon's circle equation from every other beacon's
// linearises the quadratic terms away, leaving an over-determined linear
// system A·p = b. We solve the RSSI-weighted normal equations
// (AᵀWA) p = AᵀW b directly as a 2×2 system — so stronger (more reliable)
// beacons pull harder, and extra beacons average down per-beacon noise
// instead of being discarded.
//
// Leave-one-out: with ≥4 beacons, a plain least-squares fit lets a single
// NLOS / body-shadowed beacon mask its own residual by dragging the whole
// solution toward itself. So we also try removing each beacon in turn and
// keep the subset whose fit is tightest. This catches outliers that RSSI
// alone can't (a shadowed beacon can still read strong).
//
// Ported from the hardened standalone tracker rig
// (local_tracker_dashboard.py: _solve_weighted_ls / _solve_subset /
// _trilaterate), adapted to canvas-pixel geometry + the metres residual
// the fusion stage expects. Pure function. No globals, no logging.

import type { BeaconDistance, TrilaterationResult } from './types.ts';

/** Reject solutions whose RMS residual exceeds this many metres. A
 *  residual that high means the measured distances can't be satisfied by
 *  any point — typical of NLOS, body shadowing, or a miscalibrated
 *  beacon. The fusion stage falls back to fingerprint-only in that case. */
const MAX_ACCEPTABLE_RESIDUAL_M = 5.0;

/** Floor weight so a barely-heard beacon still contributes a little rather
 *  than vanishing (mirrors the rig's `max(weight, 1e-3)`). */
const MIN_WEIGHT = 1e-3;

/** One anchor the solve runs against: position (canvas px), radius (canvas
 *  px, = distance_m / scale), and reliability weight (from RSSI). */
interface Anchor {
  x: number;
  y: number;
  r: number;
  w: number;
}

/** Map filtered RSSI to a reliability weight. Stronger signal = lower
 *  distance noise = higher weight; below −95 dBm the reading is too weak to
 *  trust and contributes nothing. Caps at −35 dBm so an unusually hot
 *  reading doesn't dominate. Ported verbatim from the rig. */
function rssiWeight(rssi: number): number {
  if (rssi < -95) return 0;
  return 100 + Math.min(rssi, -35);
}

/** Solve the weighted 2×2 normal equations (AᵀWA) p = AᵀW b directly.
 *  `rows` are the linearised circle-difference equations
 *  (a0·x + a1·y = rhs) with per-row weight w. Returns null when the system
 *  is degenerate (colinear anchors → singular matrix). */
function solveWeightedLs(
  rows: { a0: number; a1: number; rhs: number; w: number }[],
): { x: number; y: number } | null {
  let s00 = 0;
  let s01 = 0;
  let s11 = 0;
  let t0 = 0;
  let t1 = 0;
  for (const { a0, a1, rhs, w } of rows) {
    s00 += w * a0 * a0;
    s01 += w * a0 * a1;
    s11 += w * a1 * a1;
    t0 += w * a0 * rhs;
    t1 += w * a1 * rhs;
  }
  const det = s00 * s11 - s01 * s01;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (t0 * s11 - t1 * s01) / det,
    y: (s00 * t1 - s01 * t0) / det,
  };
}

/** Weighted least-squares fix over `group` (≥3 anchors), linearised
 *  against the highest-weight (strongest) beacon in the subset. Returns the
 *  recovered point plus its RMS residual in metres, or null when degenerate. */
function solveSubset(
  group: Anchor[],
  scaleMetersPerPixel: number,
): { x: number; y: number; residual_m: number } | null {
  if (group.length < 3) return null;

  // Reference = strongest anchor; its circle is subtracted from the rest.
  let ref = group[0]!;
  for (const a of group) if (a.w > ref.w) ref = a;

  const rows: { a0: number; a1: number; rhs: number; w: number }[] = [];
  for (const a of group) {
    if (a.x === ref.x && a.y === ref.y) continue;
    rows.push({
      a0: 2 * (a.x - ref.x),
      a1: 2 * (a.y - ref.y),
      rhs: a.x * a.x - ref.x * ref.x + (a.y * a.y - ref.y * ref.y) - a.r * a.r + ref.r * ref.r,
      w: Math.min(a.w, ref.w),
    });
  }
  if (rows.length < 2) return null;

  const sol = solveWeightedLs(rows);
  if (sol == null) return null;

  // Residual: RMS of (recovered distance − measured distance) over the
  // whole group, converted from canvas px back to metres for the fusion
  // stage's confidence weighting.
  let sse = 0;
  for (const a of group) {
    const errPx = Math.hypot(sol.x - a.x, sol.y - a.y) - a.r;
    sse += errPx * errPx;
  }
  const rmsPx = Math.sqrt(sse / group.length);
  return { x: sol.x, y: sol.y, residual_m: rmsPx * scaleMetersPerPixel };
}

/**
 * Solve for the patient's canvas position from per-beacon distances.
 *
 *  Uses every supplied beacon (weighted by RSSI), not just the strongest
 *  three. With ≥4 beacons a leave-one-out search drops the single beacon
 *  whose removal tightens the fit most (NLOS / shadowing).
 *
 *  Returns null when:
 *   - Fewer than 3 beacon distances supplied.
 *   - `scaleMetersPerPixel` is non-finite or ≤ 0.
 *   - The geometry is degenerate (colinear → singular system).
 *   - The best fit is still geometrically inconsistent (residual exceeds
 *     MAX_ACCEPTABLE_RESIDUAL_M).
 */
export function trilaterate(
  beaconDistances: BeaconDistance[],
  scaleMetersPerPixel: number,
): TrilaterationResult | null {
  if (beaconDistances.length < 3) return null;
  if (!Number.isFinite(scaleMetersPerPixel) || scaleMetersPerPixel <= 0) return null;

  const anchors: Anchor[] = beaconDistances.map((b) => ({
    x: b.x_canvas,
    y: b.y_canvas,
    r: b.distance_m / scaleMetersPerPixel,
    w: Math.max(rssiWeight(b.rssi), MIN_WEIGHT),
  }));

  let best = solveSubset(anchors, scaleMetersPerPixel);
  if (best == null) return null;

  // Leave-one-out: drop each beacon in turn; keep the subset whose fit is
  // tightest. An outlier drags a full-set least-squares fit toward itself,
  // hiding its own residual — removing it is what exposes the better fit.
  if (anchors.length >= 4) {
    for (let i = 0; i < anchors.length; i++) {
      const subset = anchors.slice(0, i).concat(anchors.slice(i + 1));
      const cand = solveSubset(subset, scaleMetersPerPixel);
      if (cand != null && cand.residual_m < best.residual_m) best = cand;
    }
  }

  if (best.residual_m > MAX_ACCEPTABLE_RESIDUAL_M) return null;
  return { x_canvas: best.x, y_canvas: best.y, residual_m: best.residual_m };
}
