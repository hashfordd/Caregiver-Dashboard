// Indoor position motion-gate. The server already smooths estimates (weighted
// moving average in the position_estimator edge function), but RSSI noise still
// makes a *stationary* patient's marker wander a metre or two. This gate uses
// the wearable's IMU activity class to decide whether that movement is real:
//
//   - resting → HOLD the marker at an anchor captured when rest began, ignoring
//     triangulation jitter (so "Near the door" etc. stops false-flipping).
//   - light / active → TRACK, smoothing toward the live estimate with a light
//     EMA so motion is responsive but not jumpy.
//
// A genuine move the IMU misses (e.g. a wheelchair transfer) still releases the
// hold once the estimate sits far from the anchor for a few consecutive ticks.
//
// Pure + stateless across calls (state is threaded in/out) so it unit-tests
// cleanly and a store can own the per-patient instance.

import type { ActivityState } from '@/lib/activity';

export interface GateInput {
  x: number;
  y: number;
  recorded_at: string;
  confidence: number;
}

export interface GateDisplay {
  x: number;
  y: number;
  confidence: number;
  recorded_at: string;
  /** True while the marker is frozen at the rest anchor. */
  held: boolean;
}

interface DisplayPoint {
  x: number;
  y: number;
  confidence: number;
  recorded_at: string;
}

export interface GateState {
  anchor: { x: number; y: number } | null;
  display: DisplayPoint | null;
  lastState: ActivityState | null;
  lastRecordedAt: string | null;
  farTicks: number;
  held: boolean;
}

/** EMA weight toward the live estimate while moving. Active is snappier than
 *  light so brisk walking keeps up; both stay below 1 to damp single-tick
 *  spikes. */
export const EMA_ALPHA_LIGHT = 0.4;
export const EMA_ALPHA_ACTIVE = 0.6;
/** Release a rest hold once the estimate sits this far from the anchor for
 *  RELEASE_TICKS consecutive ticks. */
export const RELEASE_DISTANCE_M = 1.5;
export const RELEASE_TICKS = 3;

export function initGateState(): GateState {
  return {
    anchor: null,
    display: null,
    lastState: null,
    lastRecordedAt: null,
    farTicks: 0,
    held: false,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toDisplay(d: DisplayPoint, held: boolean): GateDisplay {
  return { x: d.x, y: d.y, confidence: d.confidence, recorded_at: d.recorded_at, held };
}

/** Advance the gate by one estimate. `input` is the latest indoor estimate (or
 *  null to clear, e.g. outdoor / no fix); `activity` is the patient's current
 *  motion class; `scaleMetersPerPixel` converts the release threshold to canvas
 *  pixels (null → distance-based release is disabled, only activity changes can
 *  release a hold). */
export function stepGate(
  prev: GateState,
  input: GateInput | null,
  activity: ActivityState | null,
  scaleMetersPerPixel: number | null,
): { state: GateState; display: GateDisplay | null } {
  if (input == null) {
    return { state: initGateState(), display: null };
  }

  // Idempotent: the IMU and position streams tick independently and several
  // components drive this gate. Re-running the same estimate under the same
  // activity must not double-smooth or advance the release counter.
  if (
    prev.display != null &&
    input.recorded_at === prev.lastRecordedAt &&
    activity === prev.lastState
  ) {
    return { state: prev, display: toDisplay(prev.display, prev.held) };
  }

  if (activity === 'resting') {
    const entering = prev.lastState !== 'resting';
    const anchor =
      entering || prev.anchor == null
        ? prev.display
          ? { x: prev.display.x, y: prev.display.y }
          : { x: input.x, y: input.y }
        : prev.anchor;

    // Distance from the live estimate to the anchor, in metres.
    const distPx = Math.hypot(input.x - anchor.x, input.y - anchor.y);
    const distM = scaleMetersPerPixel != null ? distPx * scaleMetersPerPixel : null;
    const isFar = distM != null && distM > RELEASE_DISTANCE_M;
    const farTicks = entering ? 0 : isFar ? prev.farTicks + 1 : 0;

    if (farTicks >= RELEASE_TICKS) {
      // Genuine move the IMU missed: re-anchor on the new spot and hold there.
      const display: DisplayPoint = {
        x: input.x,
        y: input.y,
        confidence: input.confidence,
        recorded_at: input.recorded_at,
      };
      const state: GateState = {
        anchor: { x: input.x, y: input.y },
        display,
        lastState: 'resting',
        lastRecordedAt: input.recorded_at,
        farTicks: 0,
        held: true,
      };
      return { state, display: toDisplay(display, true) };
    }

    // Hold at the anchor; surface the latest confidence/timestamp so freshness
    // still updates while the position is frozen.
    const display: DisplayPoint = {
      x: anchor.x,
      y: anchor.y,
      confidence: input.confidence,
      recorded_at: input.recorded_at,
    };
    const state: GateState = {
      anchor,
      display,
      lastState: 'resting',
      lastRecordedAt: input.recorded_at,
      farTicks,
      held: true,
    };
    return { state, display: toDisplay(display, true) };
  }

  // Moving (light / active) or activity unknown: track with a light EMA.
  const alpha = activity === 'active' ? EMA_ALPHA_ACTIVE : EMA_ALPHA_LIGHT;
  const base = prev.display ?? { x: input.x, y: input.y };
  const display: DisplayPoint = {
    x: lerp(base.x, input.x, alpha),
    y: lerp(base.y, input.y, alpha),
    confidence: input.confidence,
    recorded_at: input.recorded_at,
  };
  const state: GateState = {
    anchor: null,
    display,
    lastState: activity,
    lastRecordedAt: input.recorded_at,
    farTicks: 0,
    held: false,
  };
  return { state, display: toDisplay(display, false) };
}
