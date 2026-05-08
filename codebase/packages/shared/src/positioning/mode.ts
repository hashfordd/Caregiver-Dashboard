// F8 stage 7: indoor↔outdoor mode decision (POS-08).
//
// Hysteresis: the applied mode only flips once ≥ 5 consecutive ticks of
// the same candidate condition agree. At ~1 Hz that's roughly 5 s of
// stable signal — long enough to ride out doorway transients but short
// enough that real movement crosses the boundary on time.
//
// Candidate condition definitions:
//   - "outdoor candidate" → GPS strong AND indoor confidence weak.
//   - "indoor candidate"  → GPS lost (no fix or fix too old).
// Anything else is "neutral" — neither pulls the mode toward a flip.
// The mode-decision counts back through `recentEstimates`, summing
// consecutive matching candidates from the most recent prior row.
// When the count reaches `HYSTERESIS_TICKS - 1` and the *current* tick
// matches, the flip fires.
//
// Why store candidate condition separately from `mode`: prior rows
// carry the *applied* mode, not the *candidate* signal that fed it.
// Without persisting candidates, the only signal a stateless function
// has is the applied mode, which is too late — by then the flip has
// already happened. The migration adds `indoor_confidence` and
// `gps_strong` columns for exactly this purpose.
//
// Backwards compatibility: rows written before the migration carry
// NULL for both fields. The check treats null as "no information" and
// counts neither for nor against a flip — so a window populated with
// all-null rows degrades to the V1 single-tick decision. As new rows
// land, hysteresis kicks in naturally.
//
// Phase G item 55: cold-start exception. When `recentEstimates.length
// === 0` (no priors yet — first tick after install / reinstall /
// position_estimates wipe), hysteresis can't gather evidence, and the
// previous default ("hold at indoor") meant a patient walking out the
// door for the first time would have their first ~5 s of outdoor
// estimates persisted as bogus indoor canvas coords. With no history
// to defend, accept the current candidate immediately if it's
// non-neutral.
//
// Pure function.

import type { GpsFix } from '../mqtt/signals.ts';
import type { RecentEstimate } from './types.ts';

/** Hdop above this counts as a weak GPS fix. */
export const GPS_HDOP_MAX = 2.0;
/** Fix age above this counts as a stale GPS fix. */
export const GPS_FIX_AGE_MAX_S = 5;
/** Indoor-confidence below this counts as "indoor weak". */
export const INDOOR_WEAK_CONFIDENCE = 0.3;
/** Number of consecutive matching candidates (current tick + N-1 prior)
 *  required to flip the mode. 5 ticks ≈ 5 s at the publishing rate. */
export const HYSTERESIS_TICKS = 5;

interface DecideModeInput {
  /** Last N estimates for the patient, *descending* by recorded_at.
   *  N must be ≥ HYSTERESIS_TICKS - 1 so the orchestrator query covers
   *  the full hysteresis window. */
  recentEstimates: RecentEstimate[];
  /** The current tick's GPS fix, if any. */
  gpsFix: GpsFix | undefined;
  /** The current tick's indoor confidence (output of scoreConfidence
   *  for the indoor path). */
  indoorConfidence: number;
}

/** Decision result + the candidate signals the orchestrator should
 *  persist on this tick's row. Returned together so the orchestrator
 *  doesn't recompute them. */
export interface ModeDecision {
  mode: 'indoor' | 'outdoor';
  /** Echoed back so the orchestrator writes the same value it fed in. */
  indoorConfidence: number;
  /** Computed once here; orchestrator persists for the next tick's
   *  hysteresis read. */
  gpsStrong: boolean;
}

export function decideMode(input: DecideModeInput): ModeDecision {
  const gpsStrong = isGpsStrong(input.gpsFix);
  const indoorConfidence = input.indoorConfidence;

  const currentCandidate = classify(gpsStrong, indoorConfidence);

  // Phase G item 55: cold-start exception. With zero priors, the
  // hysteresis window can't accumulate evidence, so accept whatever
  // the current tick says. A non-neutral candidate flips immediately;
  // a neutral candidate falls through to the legacy default ('indoor').
  if (input.recentEstimates.length === 0) {
    if (currentCandidate !== 'neutral') {
      return { mode: currentCandidate, indoorConfidence, gpsStrong };
    }
    return { mode: 'indoor', indoorConfidence, gpsStrong };
  }

  // Most-recent applied mode is whatever the last persisted row says.
  const previousAppliedMode = input.recentEstimates[0]!.mode;

  // Either the current candidate doesn't pull, or it agrees with the
  // already-applied mode → no flip possible. Just hold.
  if (currentCandidate === 'neutral' || currentCandidate === previousAppliedMode) {
    return { mode: previousAppliedMode, indoorConfidence, gpsStrong };
  }

  // Count consecutive prior ticks that *also* matched this candidate.
  // We only need (HYSTERESIS_TICKS - 1) prior matches because the
  // current tick is the Nth.
  let consecutive = 1;
  for (const row of input.recentEstimates) {
    const rowCandidate = classify(row.gps_strong, row.indoor_confidence);
    if (rowCandidate !== currentCandidate) break;
    consecutive++;
    if (consecutive >= HYSTERESIS_TICKS) break;
  }

  if (consecutive >= HYSTERESIS_TICKS) {
    return { mode: currentCandidate, indoorConfidence, gpsStrong };
  }
  return { mode: previousAppliedMode, indoorConfidence, gpsStrong };
}

function isGpsStrong(gps: GpsFix | undefined): boolean {
  if (gps == null) return false;
  const hdop = gps.hdop ?? Number.POSITIVE_INFINITY;
  const age = gps.fix_age_s ?? Number.POSITIVE_INFINITY;
  return hdop < GPS_HDOP_MAX && age < GPS_FIX_AGE_MAX_S;
}

/** Map per-tick signals to a flip-candidate. "neutral" means the tick
 *  doesn't push toward either mode (e.g. weak GPS plus solid indoor
 *  fingerprint — the patient is clearly inside but we wouldn't *flip*
 *  on it; the prior mode just holds). */
function classify(
  gpsStrong: boolean | null,
  indoorConfidence: number | null,
): 'indoor' | 'outdoor' | 'neutral' {
  if (gpsStrong == null && indoorConfidence == null) return 'neutral';
  // Outdoor candidate: GPS strong AND indoor confidence is weak.
  if (gpsStrong === true && indoorConfidence != null && indoorConfidence < INDOOR_WEAK_CONFIDENCE) {
    return 'outdoor';
  }
  // Indoor candidate: GPS lost. (Per F8.md POS-08: "switch to indoor
  // only when GPS has been lost for ≥ 5 s".) An indoor-strong tick with
  // GPS still strong shouldn't push toward indoor — that's neutral.
  if (gpsStrong === false) {
    return 'indoor';
  }
  return 'neutral';
}
