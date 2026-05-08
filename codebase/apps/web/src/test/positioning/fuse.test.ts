import { describe, it, expect } from 'vitest';
import { fuse } from '@alzcare/shared/positioning';

describe('fuse', () => {
  it('returns null when both inputs are null', () => {
    expect(fuse(null, null)).toBeNull();
  });

  it('returns the trilateration result when fingerprint is null', () => {
    const result = fuse({ x_canvas: 100, y_canvas: 200, residual_m: 0.5 }, null);
    expect(result).not.toBeNull();
    expect(result!.x_canvas).toBe(100);
    expect(result!.y_canvas).toBe(200);
    // 1 / (1 + 0.5) = 0.667
    expect(result!.fused_confidence).toBeCloseTo(0.667, 2);
  });

  it('returns the fingerprint result when trilateration is null', () => {
    const result = fuse(null, { x_canvas: 50, y_canvas: 75, k_distance: 20 });
    expect(result).not.toBeNull();
    expect(result!.x_canvas).toBe(50);
    expect(result!.y_canvas).toBe(75);
    // 1 / (1 + 20/20) = 0.5
    expect(result!.fused_confidence).toBeCloseTo(0.5, 4);
  });

  it('blends both, biased toward the higher-confidence side', () => {
    // Trilat very confident (residual 0 → conf ~1); fingerprint less
    // confident. Result should be near the trilat coordinates.
    const result = fuse(
      { x_canvas: 100, y_canvas: 100, residual_m: 0 },
      { x_canvas: 200, y_canvas: 200, k_distance: 60 },
    );
    expect(result).not.toBeNull();
    // The trilat weight (1.0) is much higher than the fingerprint
    // weight (1/(1+3) = 0.25), so the blend lands near (100, 100).
    expect(result!.x_canvas).toBeLessThan(140);
    expect(result!.y_canvas).toBeLessThan(140);
  });

  it('blends 50/50 in coords when both confidences are equal; fused_confidence is the probabilistic OR', () => {
    // Phase G item 58: fused_confidence is now `1 - (1-wT)*(1-wF)` so
    // two 0.5-confidence signals yield 1 - 0.5 * 0.5 = 0.75 (each
    // signal independently contributes evidence). Coordinate weights
    // are still arithmetic.
    const result = fuse(
      { x_canvas: 0, y_canvas: 0, residual_m: 1 }, // conf 0.5
      { x_canvas: 100, y_canvas: 100, k_distance: 20 }, // conf 0.5
    );
    expect(result).not.toBeNull();
    expect(result!.x_canvas).toBeCloseTo(50, 5);
    expect(result!.y_canvas).toBeCloseTo(50, 5);
    expect(result!.fused_confidence).toBeCloseTo(0.75, 5);
  });

  it('Phase G item 58: two strong signals reinforce — confidence > each input', () => {
    // 0.9 wT, 0.9 wF → 1 - 0.1*0.1 = 0.99
    const result = fuse(
      { x_canvas: 0, y_canvas: 0, residual_m: 1 / 9 }, // conf ≈ 0.9
      { x_canvas: 0, y_canvas: 0, k_distance: 20 / 9 }, // conf ≈ 0.9
    );
    expect(result).not.toBeNull();
    expect(result!.fused_confidence).toBeGreaterThan(0.9);
  });

  it('clamps fused_confidence to [0, 1]', () => {
    // Negative residual is non-physical but the function should not
    // produce > 1 confidence regardless.
    const result = fuse({ x_canvas: 0, y_canvas: 0, residual_m: -5 }, null);
    expect(result!.fused_confidence).toBeLessThanOrEqual(1);
    expect(result!.fused_confidence).toBeGreaterThanOrEqual(0);
  });
});
