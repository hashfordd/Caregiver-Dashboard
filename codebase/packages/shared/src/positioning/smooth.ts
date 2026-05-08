// F8 stage 5: weighted moving average over the current fused result and
// the last 5 estimates. Suppresses single-tick spikes (NLOS, dropout)
// without lagging real motion meaningfully at 1 Hz.
//
// Stateless: history is supplied by the caller (the orchestrator reads
// it from the DB). Cold start (no history) returns the unmodified
// fused result with jump_m = 0.
//
// Weights are exponential decay: most recent prior has 0.5×, second
// 0.25×, etc., plus 1.0× for the current tick. Renormalised before the
// blend so the weights always sum to 1.
//
// Pure function.

import type { FusedResult, RecentEstimate, SmoothedResult } from './types.ts';

/** Per-row weights, oldest-to-newest among the past 5. The current
 *  tick is added on top with weight 1.0 inside the function. */
const HISTORY_WEIGHTS_NEWEST_FIRST = [0.5, 0.25, 0.125, 0.075, 0.05];

const CURRENT_TICK_WEIGHT = 1.0;

/** Smooth the current fused position against recent history.
 *
 *  - `recent` is descending by recorded_at (most recent first), as
 *    the orchestrator reads it.
 *  - Outdoor rows (mode === 'outdoor' or null x/y) are skipped — a
 *    mode flip invalidates prior canvas history.
 *  - `jump_m` is the metric distance from the smoothed result to the
 *    most recent prior INDOOR row. 0 on cold start.
 */
export function smooth(
  current: FusedResult,
  recent: RecentEstimate[],
  scaleMetersPerPixel: number,
): SmoothedResult {
  const usable = recent
    .filter((r) => r.mode === 'indoor' && r.x_canvas != null && r.y_canvas != null)
    .slice(0, HISTORY_WEIGHTS_NEWEST_FIRST.length);

  if (usable.length === 0) {
    return { x_canvas: current.x_canvas, y_canvas: current.y_canvas, jump_m: 0 };
  }

  let totalWeight = CURRENT_TICK_WEIGHT;
  let sumX = CURRENT_TICK_WEIGHT * current.x_canvas;
  let sumY = CURRENT_TICK_WEIGHT * current.y_canvas;
  for (let i = 0; i < usable.length; i++) {
    const w = HISTORY_WEIGHTS_NEWEST_FIRST[i]!;
    totalWeight += w;
    sumX += w * (usable[i]!.x_canvas as number);
    sumY += w * (usable[i]!.y_canvas as number);
  }
  const x = sumX / totalWeight;
  const y = sumY / totalWeight;

  // Jump from previous indoor estimate, in metres.
  const prev = usable[0]!;
  const dxPx = x - (prev.x_canvas as number);
  const dyPx = y - (prev.y_canvas as number);
  const jump_m = Math.sqrt(dxPx * dxPx + dyPx * dyPx) * scaleMetersPerPixel;

  return { x_canvas: x, y_canvas: y, jump_m };
}
