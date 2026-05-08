// F8 stage 6: confidence scoring (POS-07).
//
// Combines three signals into one 0..1 number that the dashboard
// surfaces as marker opacity (clamped to a minimum visible value
// upstream so the marker never disappears):
//
//   signal_availability = min(1, beaconCount / 3)        // saturate at 3 beacons
//   match_quality       = fusedConfidence (0..1, from fuse.ts)
//   smoothness          = 1 / (1 + jumpM)                // lower jump → higher confidence
//   confidence = 0.4 * signal_availability + 0.4 * match_quality + 0.2 * smoothness
//
// Pure function.

interface ConfidenceInput {
  /** Number of placed, calibrated beacons that contributed to this
   *  estimate (i.e. heard in the observation AND in the `beacons`
   *  table with placement). */
  beaconCount: number;
  /** Output of fuse.ts (0..1). */
  fusedConfidence: number;
  /** Distance from the previous estimate, in metres. Cold start = 0. */
  jumpM: number;
}

const BEACON_SATURATION = 3;
const W_AVAILABILITY = 0.4;
const W_MATCH_QUALITY = 0.4;
const W_SMOOTHNESS = 0.2;

export function scoreConfidence({ beaconCount, fusedConfidence, jumpM }: ConfidenceInput): number {
  const availability = Math.min(1, Math.max(0, beaconCount) / BEACON_SATURATION);
  const matchQuality = clamp01(fusedConfidence);
  const smoothness = 1 / (1 + Math.max(0, jumpM));
  const score =
    W_AVAILABILITY * availability + W_MATCH_QUALITY * matchQuality + W_SMOOTHNESS * smoothness;
  return clamp01(score);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
