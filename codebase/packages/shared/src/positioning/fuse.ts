// F8 stage 4: confidence-weighted blend of trilateration + fingerprint.
//
//   trilat_confidence     = 1 / (1 + residual_m)
//   fingerprint_confidence = 1 / (1 + k_distance / 20)
//   fused.x = (w_t*tx + w_f*fx) / (w_t + w_f)
//   fused.y = (w_t*ty + w_f*fy) / (w_t + w_f)
//   fused_confidence = 1 - (1 - w_t) * (1 - w_f)   (probabilistic OR)
//
// Pure function.
//
// Phase G item 58: fused_confidence now uses the probabilistic-OR
// shape (independence assumption: the two signals are independent
// estimators, so the chance that *either* is right is 1 minus the
// chance that *both* are wrong). The previous arithmetic mean
// `(w_t + w_f) / 2` capped strong+strong at the average — two perfect
// signals produced 1.0 only when each was perfect, but a single perfect
// signal + a fairly strong one produced ~0.75 instead of ~0.95. The
// audit flagged this as "doesn't actually reward agreement"; the
// probabilistic OR does.

import type { FingerprintResult, FusedResult, TrilaterationResult } from './types.ts';

/** k_distance scaling factor in the fingerprint-confidence formula.
 *  20 means "a k-distance of 20 dB → 0.5 confidence"; tunable. */
const FINGERPRINT_DISTANCE_SCALE = 20;

export function fuse(
  trilat: TrilaterationResult | null,
  fingerprint: FingerprintResult | null,
): FusedResult | null {
  if (trilat == null && fingerprint == null) return null;
  if (trilat == null && fingerprint != null) {
    const conf = 1 / (1 + fingerprint.k_distance / FINGERPRINT_DISTANCE_SCALE);
    return {
      x_canvas: fingerprint.x_canvas,
      y_canvas: fingerprint.y_canvas,
      fused_confidence: clamp01(conf),
    };
  }
  if (fingerprint == null && trilat != null) {
    const conf = 1 / (1 + trilat.residual_m);
    return {
      x_canvas: trilat.x_canvas,
      y_canvas: trilat.y_canvas,
      fused_confidence: clamp01(conf),
    };
  }
  // Both present — weighted average over coordinates, probabilistic-OR
  // over confidences. Two strong signals reinforce each other on the
  // confidence side; two weak ones still produce a low confidence.
  const t = trilat!;
  const f = fingerprint!;
  const wT = clamp01(1 / (1 + t.residual_m));
  const wF = clamp01(1 / (1 + f.k_distance / FINGERPRINT_DISTANCE_SCALE));
  const total = wT + wF;
  return {
    x_canvas: (wT * t.x_canvas + wF * f.x_canvas) / total,
    y_canvas: (wT * t.y_canvas + wF * f.y_canvas) / total,
    fused_confidence: clamp01(1 - (1 - wT) * (1 - wF)),
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
