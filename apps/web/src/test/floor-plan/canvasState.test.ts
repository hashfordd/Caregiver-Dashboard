import { describe, it, expect } from 'vitest';
import { computeScale, formatScale, isCanvasJson } from '@/features/floor-plan/canvasState';

describe('computeScale', () => {
  it('divides metres by pixel length', () => {
    expect(computeScale(100, 5)).toBeCloseTo(0.05, 6);
    expect(computeScale(250, 1)).toBeCloseTo(0.004, 6);
  });

  it('rejects zero or negative pixel length', () => {
    expect(() => computeScale(0, 5)).toThrow();
    expect(() => computeScale(-10, 5)).toThrow();
  });

  it('rejects zero or negative metres', () => {
    expect(() => computeScale(100, 0)).toThrow();
    expect(() => computeScale(100, -1)).toThrow();
  });

  it('rejects non-finite inputs', () => {
    expect(() => computeScale(Number.NaN, 5)).toThrow();
    expect(() => computeScale(Number.POSITIVE_INFINITY, 5)).toThrow();
    expect(() => computeScale(100, Number.NaN)).toThrow();
  });
});

describe('formatScale', () => {
  it('renders metres for ≥ 1 cm/px', () => {
    expect(formatScale(0.05)).toBe('1 px = 0.050 m');
    expect(formatScale(1)).toBe('1 px = 1.000 m');
  });

  it('falls back to centimetres below 1 cm/px', () => {
    expect(formatScale(0.005)).toBe('1 px = 0.50 cm');
  });

  it('renders a placeholder for missing or invalid values', () => {
    expect(formatScale(null)).toBe('No scale set');
    expect(formatScale(0)).toBe('No scale set');
    expect(formatScale(Number.NaN)).toBe('No scale set');
  });
});

describe('isCanvasJson', () => {
  it('accepts an object with an objects array', () => {
    expect(isCanvasJson({ objects: [] })).toBe(true);
    expect(isCanvasJson({ objects: [{ type: 'line' }] })).toBe(true);
  });

  it('rejects non-object or missing-array shapes', () => {
    expect(isCanvasJson(null)).toBe(false);
    expect(isCanvasJson('foo')).toBe(false);
    expect(isCanvasJson({})).toBe(false);
    expect(isCanvasJson({ objects: 'not-an-array' })).toBe(false);
  });
});
