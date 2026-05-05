// F8 stage 7: indoor↔outdoor mode decision (POS-08).
//
// V1 algorithm: return the candidate based on the current tick's GPS
// fix and indoor confidence. No hysteresis at this layer.
//
// Why no hysteresis: the F8.md spec calls for "5 consecutive seconds"
// of agreement before flipping. Implementing that without an extra DB
// column requires storing the per-tick *candidate condition*, which
// would mean adding `indoor_confidence` (and possibly `gps_strong`) as
// columns on `position_estimates`. The mode column alone can't carry
// the signal because by definition prior rows wear the *applied* mode,
// not the candidate. BACKLOG entry tracks the column addition for V2.
//
// In practice at 1 Hz the candidate is stable enough (GPS doesn't flap
// between hdop<2 and hdop>2 second-to-second except at obstruction
// boundaries) that a 1-tick decision rarely produces visible flapping.
// F11 zone-rule firing tolerates short transients per its own design.
//
// Pure function.

import type { GpsFix } from '../mqtt/signals.js';
import type { RecentEstimate } from './types.js';

/** GPS-quality thresholds for "outdoor-eligible" per F8.md. */
const GPS_HDOP_MAX = 2.0;
const GPS_FIX_AGE_MAX_S = 5;

/** Indoor confidence below this is considered "indoor-weak" — paired
 *  with strong GPS, that's the trigger for an outdoor switch. */
const INDOOR_WEAK_CONFIDENCE = 0.3;

interface DecideModeInput {
  /** Last N estimates for the patient, descending by recorded_at.
   *  Currently unused at this layer (V1 returns the candidate without
   *  hysteresis); kept in the signature so the eventual V2 column-
   *  backed hysteresis is additive. */
  recentEstimates: RecentEstimate[];
  /** The current tick's GPS fix, if any. */
  gpsFix: GpsFix | undefined;
  /** The current tick's indoor confidence (output of scoreConfidence
   *  for the indoor path). */
  indoorConfidence: number;
}

export function decideMode({ gpsFix, indoorConfidence }: DecideModeInput): 'indoor' | 'outdoor' {
  const gpsStrong =
    gpsFix != null &&
    (gpsFix.hdop ?? Number.POSITIVE_INFINITY) < GPS_HDOP_MAX &&
    (gpsFix.fix_age_s ?? Number.POSITIVE_INFINITY) < GPS_FIX_AGE_MAX_S;
  const indoorWeak = indoorConfidence < INDOOR_WEAK_CONFIDENCE;
  if (gpsStrong && indoorWeak) return 'outdoor';
  return 'indoor';
}
