// F8 orchestrator: runs all eight stages on a single SignalsMessage,
// returns a PositionPipelineOutput row for insertion (or null when the
// estimate isn't computable). Pure function — DB reads happen in the
// caller (the `position_estimator` edge function) and are passed in via
// `recentEstimates`.

import type { PositionPipelineInput, PositionPipelineOutput } from './types.ts';
import { rssiVectorToDistances } from './pathLoss.ts';
import { trilaterate } from './trilaterate.ts';
import { fingerprintMatch } from './fingerprint.ts';
import { fuse } from './fuse.ts';
import { smooth } from './smooth.ts';
import { scoreConfidence } from './confidence.ts';
import { decideMode } from './mode.ts';

export function runPositionPipeline(input: PositionPipelineInput): PositionPipelineOutput | null {
  const { signals, beacons, calibrationPoints, recentEstimates, scaleMetersPerPixel } = input;
  const exponent = input.pathLossExponent ?? 2.0;

  // Stage 1: RSSI → distances per beacon.
  const distances = rssiVectorToDistances(signals.ble, beacons, exponent);

  // Stage 2: trilateration over the strongest 3.
  const trilatResult = trilaterate(distances, scaleMetersPerPixel);

  // Stage 3: kNN fingerprint match.
  const fpResult = fingerprintMatch({ ble: signals.ble, wifi: signals.wifi }, calibrationPoints);

  // Stage 4: fuse. Null = no indoor estimate computable this tick.
  const fused = fuse(trilatResult, fpResult);

  // Indoor path requires a fused result. If neither trilat nor
  // fingerprint produced anything AND there's no GPS fix to fall back
  // on, emit nothing — the realtime stream stays at the last known
  // position.
  if (fused == null) {
    if (signals.gps == null) return null;
    // Outdoor-only: no indoor data to write, but we have GPS. We still
    // ask decideMode (with indoorConfidence = 0) which, with strong
    // GPS, will eventually flip to outdoor — until that flip the row
    // is suppressed (we'd need a canvas position for indoor mode and
    // we don't have one).
    const mode = decideMode({
      recentEstimates,
      gpsFix: signals.gps,
      indoorConfidence: 0,
    });
    if (mode === 'outdoor') {
      return outdoorRow(signals, gpsConfidence(signals.gps));
    }
    return null;
  }

  // Stage 5: smooth against recent indoor history.
  const smoothed = smooth(fused, recentEstimates, scaleMetersPerPixel);

  // Stage 6: confidence (indoor candidate).
  const indoorConfidence = scoreConfidence({
    beaconCount: distances.length,
    fusedConfidence: fused.fused_confidence,
    jumpM: smoothed.jump_m,
  });

  // Stage 7: mode (hysteretic).
  const mode = decideMode({
    recentEstimates,
    gpsFix: signals.gps,
    indoorConfidence,
  });

  if (mode === 'outdoor') {
    return outdoorRow(signals, gpsConfidence(signals.gps));
  }

  // Stage 8: assemble indoor row.
  return {
    recorded_at: signals.recorded_at,
    mode: 'indoor',
    x_canvas: smoothed.x_canvas,
    y_canvas: smoothed.y_canvas,
    lat: signals.gps?.lat ?? null,
    lng: signals.gps?.lng ?? null,
    confidence: indoorConfidence,
  };
}

function outdoorRow(
  signals: PositionPipelineInput['signals'],
  confidence: number,
): PositionPipelineOutput {
  return {
    recorded_at: signals.recorded_at,
    mode: 'outdoor',
    x_canvas: null,
    y_canvas: null,
    lat: signals.gps?.lat ?? null,
    lng: signals.gps?.lng ?? null,
    confidence,
  };
}

/** Cheap GPS-confidence proxy: 1 / (1 + hdop). Caps near 1 when HDOP is
 *  small (good fix), drops toward 0 as HDOP rises. Maps HDOP undefined
 *  to a neutral 0.5. */
function gpsConfidence(gps: PositionPipelineInput['signals']['gps']): number {
  if (gps == null) return 0;
  const hdop = gps.hdop ?? 1.0;
  return 1 / (1 + Math.max(0, hdop));
}
