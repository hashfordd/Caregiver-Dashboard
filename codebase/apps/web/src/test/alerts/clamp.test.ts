import { describe, expect, it } from 'vitest';
import { clampToRange } from '@/features/alerts/inputs/clamp';

describe('clampToRange', () => {
  it('returns the value when within range', () => {
    expect(clampToRange(50, 0, 100)).toBe(50);
  });

  it('clamps below min and above max', () => {
    expect(clampToRange(-5, 0, 100)).toBe(0);
    expect(clampToRange(250, 0, 220)).toBe(220);
  });

  it('treats bounds as optional', () => {
    expect(clampToRange(-5, undefined, 100)).toBe(-5);
    expect(clampToRange(250, 0, undefined)).toBe(250);
    expect(clampToRange(7)).toBe(7);
  });

  it('passes non-finite values through for upstream empty/invalid handling', () => {
    expect(clampToRange(Number.NaN, 0, 100)).toBeNaN();
    expect(clampToRange(Number.POSITIVE_INFINITY, 0, 100)).toBe(Number.POSITIVE_INFINITY);
  });
});
