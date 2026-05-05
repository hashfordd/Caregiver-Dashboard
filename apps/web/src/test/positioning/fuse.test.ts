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

  it('blends 50/50 when both confidences are equal', () => {
    const result = fuse(
      { x_canvas: 0, y_canvas: 0, residual_m: 1 }, // conf 0.5
      { x_canvas: 100, y_canvas: 100, k_distance: 20 }, // conf 0.5
    );
    expect(result).not.toBeNull();
    expect(result!.x_canvas).toBeCloseTo(50, 5);
    expect(result!.y_canvas).toBeCloseTo(50, 5);
    expect(result!.fused_confidence).toBe(0.5);
  });

  it('clamps fused_confidence to [0, 1]', () => {
    // Negative residual is non-physical but the function should not
    // produce > 1 confidence regardless.
    const result = fuse({ x_canvas: 0, y_canvas: 0, residual_m: -5 }, null);
    expect(result!.fused_confidence).toBeLessThanOrEqual(1);
    expect(result!.fused_confidence).toBeGreaterThanOrEqual(0);
  });
});
