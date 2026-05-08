import { describe, it, expect } from 'vitest';
import { scoreConfidence } from '@alzcare/shared/positioning';

describe('scoreConfidence', () => {
  it('returns near 1.0 with 3 beacons + perfect match + zero jump', () => {
    const c = scoreConfidence({ beaconCount: 3, fusedConfidence: 1, jumpM: 0 });
    // Saturated availability (1) + match (1) + smoothness (1) = 1.0
    expect(c).toBe(1);
  });

  it('returns near 0 with zero beacons and zero match quality', () => {
    const c = scoreConfidence({ beaconCount: 0, fusedConfidence: 0, jumpM: 1000 });
    // 0.4*0 + 0.4*0 + 0.2*~0 ≈ 0
    expect(c).toBeLessThan(0.01);
  });

  it('mid-range when match is perfect but a 5 m jump applies the smoothness penalty', () => {
    const c = scoreConfidence({ beaconCount: 3, fusedConfidence: 1, jumpM: 5 });
    // 0.4*1 + 0.4*1 + 0.2*(1/(1+5)) = 0.8 + 0.033 = 0.833
    expect(c).toBeCloseTo(0.833, 2);
  });

  it('saturates beacon-availability at the BEACON_SATURATION cap (3)', () => {
    const c3 = scoreConfidence({ beaconCount: 3, fusedConfidence: 1, jumpM: 0 });
    const c10 = scoreConfidence({ beaconCount: 10, fusedConfidence: 1, jumpM: 0 });
    expect(c3).toBe(c10);
  });

  it('clamps the result to [0, 1]', () => {
    // No realistic input produces > 1, but defensive clamping should
    // hold even with weird inputs.
    expect(
      scoreConfidence({ beaconCount: -5, fusedConfidence: -1, jumpM: -5 }),
    ).toBeGreaterThanOrEqual(0);
    expect(scoreConfidence({ beaconCount: 100, fusedConfidence: 5, jumpM: 0 })).toBeLessThanOrEqual(
      1,
    );
  });
});
