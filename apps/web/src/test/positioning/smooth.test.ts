import { describe, it, expect } from 'vitest';
import { smooth } from '@alzcare/shared/positioning';
import type { RecentEstimate } from '@alzcare/shared/positioning';

const SCALE = 0.02; // 50 px / m

function indoorRow(t: string, x: number, y: number, conf = 0.8): RecentEstimate {
  return { recorded_at: t, mode: 'indoor', x_canvas: x, y_canvas: y, confidence: conf };
}

describe('smooth', () => {
  it('cold start (no history) returns the unmodified fused result with jump_m = 0', () => {
    const result = smooth({ x_canvas: 100, y_canvas: 200, fused_confidence: 0.9 }, [], SCALE);
    expect(result.x_canvas).toBe(100);
    expect(result.y_canvas).toBe(200);
    expect(result.jump_m).toBe(0);
  });

  it('dampens a single +5 m spike against stationary history', () => {
    // 5 stationary indoor rows at (100, 100). Current tick spikes to
    // (350, 100) — 250 px = 5 m at 0.02 mppx.
    const recent: RecentEstimate[] = Array.from({ length: 5 }, (_, i) =>
      indoorRow(`2026-05-05T12:00:0${i}Z`, 100, 100),
    );
    const result = smooth({ x_canvas: 350, y_canvas: 100, fused_confidence: 0.5 }, recent, SCALE);
    // The 5 m raw spike must be reduced by at least 40% by the smoother
    // alone. The full-pipeline 2 m budget (F8.md acceptance) is the
    // combination of smoother + fingerprint vetoing the rogue
    // trilateration; tested in pipeline.test.ts dropout case.
    const jumpFromHistory = Math.abs(result.x_canvas - 100) * SCALE;
    expect(jumpFromHistory).toBeLessThan(3);
    expect(jumpFromHistory).toBeLessThan(5 * 0.6); // ≥ 40% reduction
  });

  it('still moves toward the current measurement during sustained linear motion', () => {
    // History of constantly-moving points (1 m/s rightward, 50 px per
    // tick at 0.02 mppx). Current tick continues that motion. The
    // smoother dampens — the result lags between the most recent
    // history and the current — but it does keep advancing tick to
    // tick (proves it's not pinned to the past).
    const recent: RecentEstimate[] = Array.from({ length: 5 }, (_, i) => {
      const tickIdx = 4 - i;
      return indoorRow(`2026-05-05T12:00:0${i}Z`, 100 + tickIdx * 50, 100);
    });
    // After tick 4 at x=300, the next position is x=350.
    const result = smooth({ x_canvas: 350, y_canvas: 100, fused_confidence: 0.9 }, recent, SCALE);
    expect(result.x_canvas).toBeGreaterThan(300); // moved past the most recent history
    expect(result.x_canvas).toBeLessThanOrEqual(350); // didn't overshoot
    expect(result.jump_m).toBeGreaterThan(0);
  });

  it('skips outdoor rows in history (mode flip invalidates canvas continuity)', () => {
    const recent: RecentEstimate[] = [
      { recorded_at: 't0', mode: 'outdoor', x_canvas: null, y_canvas: null, confidence: 0.5 },
      indoorRow('t-1', 100, 100),
    ];
    const result = smooth({ x_canvas: 200, y_canvas: 100, fused_confidence: 0.7 }, recent, SCALE);
    // The single usable indoor row at (100, 100) plus the current
    // (200, 100) blend → between but closer to current. The outdoor
    // row should not have contributed a 0/null term.
    expect(result.x_canvas).toBeGreaterThan(150);
    expect(result.x_canvas).toBeLessThan(200);
  });

  it('reports jump_m in metres against the most recent indoor prior', () => {
    const recent: RecentEstimate[] = [indoorRow('t-1', 100, 100)];
    const result = smooth({ x_canvas: 200, y_canvas: 100, fused_confidence: 0.9 }, recent, SCALE);
    // Smoothed x is somewhere between 100 and 200 (heavily weighted
    // toward 200 since current weight is 1.0 and history is 0.5). The
    // jump from prev (100) to smoothed must be positive metric.
    expect(result.jump_m).toBeGreaterThan(0);
    expect(result.jump_m).toBeLessThan(2);
  });
});
