import { describe, expect, it } from 'vitest';
import {
  EMA_ALPHA_ACTIVE,
  initGateState,
  RELEASE_TICKS,
  stepGate,
  type GateInput,
  type GateState,
} from '@/features/floor-plan/motionGate';
import type { ActivityState } from '@/lib/activity';

// 20 px per metre → the 1.5 m release threshold is 30 px.
const SCALE = 0.05;

function inputAt(x: number, y: number, t: number, confidence = 0.8): GateInput {
  return { x, y, recorded_at: new Date(t * 1000).toISOString(), confidence };
}

/** Feed a sequence of (input, activity) pairs and return the final display. */
function run(seq: Array<[GateInput, ActivityState | null]>, scale: number | null = SCALE) {
  let state: GateState = initGateState();
  let display = null as ReturnType<typeof stepGate>['display'];
  for (const [input, activity] of seq) {
    ({ state, display } = stepGate(state, input, activity, scale));
  }
  return { state, display };
}

describe('stepGate — resting hold', () => {
  it('anchors on the first resting reading', () => {
    const { display } = run([[inputAt(100, 100, 1), 'resting']]);
    expect(display).toMatchObject({ x: 100, y: 100, held: true });
  });

  it('holds the anchor through small jitter (ignores triangulation drift)', () => {
    const { display } = run([
      [inputAt(100, 100, 1), 'resting'],
      [inputAt(108, 95, 2), 'resting'], // ~9 px ≈ 0.45 m < 1.5 m
      [inputAt(94, 104, 3), 'resting'],
    ]);
    expect(display).toMatchObject({ x: 100, y: 100, held: true });
  });

  it('releases after a sustained far jump and re-anchors on the new spot', () => {
    const seq: Array<[GateInput, ActivityState | null]> = [[inputAt(100, 100, 1), 'resting']];
    // RELEASE_TICKS consecutive readings ~5 m away (100 px) before release.
    for (let i = 0; i < RELEASE_TICKS; i++) {
      seq.push([inputAt(200, 100, 2 + i), 'resting']);
    }
    const { display } = run(seq);
    expect(display).toMatchObject({ x: 200, y: 100, held: true });
  });

  it('does not release on a single far reading', () => {
    const { display } = run([
      [inputAt(100, 100, 1), 'resting'],
      [inputAt(200, 100, 2), 'resting'], // far, but only one tick
    ]);
    expect(display).toMatchObject({ x: 100, y: 100, held: true });
  });

  it('keeps holding through jitter when no scale is available', () => {
    const { display } = run(
      [
        [inputAt(100, 100, 1), 'resting'],
        [inputAt(400, 400, 2), 'resting'],
        [inputAt(50, 50, 3), 'resting'],
        [inputAt(380, 420, 4), 'resting'],
      ],
      null,
    );
    expect(display).toMatchObject({ x: 100, y: 100, held: true });
  });
});

describe('stepGate — moving', () => {
  it('snaps to the first active reading then EMA-smooths toward subsequent ones', () => {
    const first = run([[inputAt(0, 0, 1), 'active']]);
    expect(first.display).toMatchObject({ x: 0, y: 0, held: false });

    const { display } = run([
      [inputAt(0, 0, 1), 'active'],
      [inputAt(10, 0, 2), 'active'],
    ]);
    expect(display?.held).toBe(false);
    expect(display?.x).toBeCloseTo(10 * EMA_ALPHA_ACTIVE); // 6
    expect(display?.y).toBe(0);
  });

  it('releases the hold and moves when the patient becomes active', () => {
    const { display } = run([
      [inputAt(100, 100, 1), 'resting'],
      [inputAt(100, 100, 2), 'resting'],
      [inputAt(140, 100, 3), 'active'], // hold releases, EMA from anchor toward 140
    ]);
    expect(display?.held).toBe(false);
    expect(display?.x).toBeGreaterThan(100);
    expect(display?.x).toBeLessThan(140);
  });
});

describe('stepGate — passthrough & idempotency', () => {
  it('clears the marker and resets when there is no indoor fix', () => {
    const cleared = stepGate(initGateState(), null, 'resting', SCALE);
    expect(cleared.display).toBeNull();
    expect(cleared.state).toEqual(initGateState());
  });

  it('is idempotent for a repeated reading under the same activity', () => {
    const a = stepGate(initGateState(), inputAt(50, 50, 1), 'light', SCALE);
    const b = stepGate(a.state, inputAt(50, 50, 1), 'light', SCALE);
    expect(b.display).toEqual(a.display);
    expect(b.state).toBe(a.state); // unchanged reference — no advance
  });

  it('does not double-smooth when the same active reading is replayed', () => {
    const a = run([
      [inputAt(0, 0, 1), 'active'],
      [inputAt(10, 0, 2), 'active'],
    ]);
    const replay = stepGate(a.state, inputAt(10, 0, 2), 'active', SCALE);
    expect(replay.display?.x).toBeCloseTo(a.display!.x);
  });
});
