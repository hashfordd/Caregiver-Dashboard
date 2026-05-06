// F8 stage 3: kNN fingerprint match in RSSI space.
//
// For each calibration_points row, compute the Euclidean RSSI-space
// distance between the live observation and the calibration's stored
// signature. Take the k nearest neighbours; output is the inverse-
// distance-weighted average of their canvas coordinates plus the
// k-th neighbour's distance (used by fuse.ts for confidence weighting).
//
// Missing-entry penalty: when one side observes a beacon the other
// doesn't, treat the absent side's RSSI as MISSING_RSSI_FLOOR (-100 dB,
// a noise floor). This stops a half-empty match from looking perfect.
//
// Stub-empty calibrations (samples: []) are skipped — F7 doesn't
// produce these in V1, but a future replay or dev fixture might, and
// giving them kNN weight would pollute the average toward the
// stub's (x, y).
//
// Pure function. No DB, no logging beyond the stub-empty warn.

import type { BleSample, WifiSample } from '../mqtt/signals.ts';
import type { CalibrationPoint, FingerprintResult } from './types.ts';

/** RSSI substitute for "the other side did not observe this beacon /
 *  BSSID". -100 dB is roughly the noise floor; substantially worse
 *  than any real observation, so missing entries register as
 *  meaningfully poor matches. */
export const MISSING_RSSI_FLOOR = -100;

/** Default k for kNN. F8.md spec value. */
export const DEFAULT_K = 3;

/** Match a live observation against the calibration corpus. Returns
 *  null when the corpus is empty (or every calibration was stub-empty). */
export function fingerprintMatch(
  observation: { ble: BleSample[]; wifi: WifiSample[] },
  calibrationPoints: CalibrationPoint[],
  k: number = DEFAULT_K,
): FingerprintResult | null {
  if (calibrationPoints.length === 0) return null;
  if (k < 1) return null;

  const obsBle = new Map<string, number>();
  for (const s of observation.ble) {
    if (Number.isFinite(s.rssi)) obsBle.set(s.mac, s.rssi);
  }
  const obsWifi = new Map<string, number>();
  for (const s of observation.wifi) {
    if (Number.isFinite(s.rssi)) obsWifi.set(s.bssid, s.rssi);
  }

  type Candidate = { x_canvas: number; y_canvas: number; rssi_distance: number };
  const candidates: Candidate[] = [];
  const skippedStubs = new Set<string>();
  for (const cal of calibrationPoints) {
    const bleSamples = cal.ble_signature.samples;
    const wifiSamples = cal.wifi_signature.samples;
    if (bleSamples.length === 0 && wifiSamples.length === 0) {
      skippedStubs.add(cal.id);
      continue;
    }
    const calBle = new Map<string, number>();
    for (const s of bleSamples) calBle.set(s.mac, s.rssi_mean);
    const calWifi = new Map<string, number>();
    for (const s of wifiSamples) calWifi.set(s.bssid, s.rssi_mean);

    // Distance² across all distinct identifiers in the union of both
    // sides, with MISSING_RSSI_FLOOR substituted for absent entries.
    const bleKeys = new Set<string>([...obsBle.keys(), ...calBle.keys()]);
    let bleSq = 0;
    for (const key of bleKeys) {
      const a = obsBle.get(key) ?? MISSING_RSSI_FLOOR;
      const b = calBle.get(key) ?? MISSING_RSSI_FLOOR;
      const d = a - b;
      bleSq += d * d;
    }
    const wifiKeys = new Set<string>([...obsWifi.keys(), ...calWifi.keys()]);
    let wifiSq = 0;
    for (const key of wifiKeys) {
      const a = obsWifi.get(key) ?? MISSING_RSSI_FLOOR;
      const b = calWifi.get(key) ?? MISSING_RSSI_FLOOR;
      const d = a - b;
      wifiSq += d * d;
    }
    const rssi_distance = Math.sqrt(bleSq + wifiSq);
    candidates.push({ x_canvas: cal.x_canvas, y_canvas: cal.y_canvas, rssi_distance });
  }

  if (skippedStubs.size > 0) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'positioning: skipped stub-empty calibration points',
        count: skippedStubs.size,
        ids: [...skippedStubs],
      }),
    );
  }

  if (candidates.length === 0) return null;

  // Sort ascending by RSSI distance — closest matches first.
  candidates.sort((a, b) => a.rssi_distance - b.rssi_distance);
  const top = candidates.slice(0, Math.min(k, candidates.length));

  // Inverse-distance weighted average of canvas coords. The +1 in the
  // denominator stops a perfect match (distance 0) from producing
  // Infinity weight; that lets a near-perfect calibration dominate
  // without monopolising.
  let sumWeight = 0;
  let sumX = 0;
  let sumY = 0;
  for (const c of top) {
    const w = 1 / (c.rssi_distance + 1);
    sumWeight += w;
    sumX += w * c.x_canvas;
    sumY += w * c.y_canvas;
  }
  return {
    x_canvas: sumX / sumWeight,
    y_canvas: sumY / sumWeight,
    k_distance: top[top.length - 1]!.rssi_distance,
  };
}
