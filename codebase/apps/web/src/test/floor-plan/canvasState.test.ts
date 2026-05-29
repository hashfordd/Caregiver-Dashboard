import { describe, it, expect } from 'vitest';
import {
  computeScale,
  computeScaleFromBeacons,
  formatScale,
  isCanvasJson,
} from '@/features/floor-plan/canvasState';

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

describe('computeScaleFromBeacons', () => {
  it('back-solves scale from the measured distance between two placed beacons', () => {
    // 100 px apart on the x-axis, 5 m measured → 0.05 m/px
    expect(computeScaleFromBeacons({ x: 0, y: 0 }, { x: 100, y: 0 }, 5)).toBeCloseTo(0.05, 6);
    // Pythagorean: 3-4-5 triangle → 5 px / 1 m = 0.2 m/px
    expect(computeScaleFromBeacons({ x: 0, y: 0 }, { x: 3, y: 4 }, 1)).toBeCloseTo(0.2, 6);
  });

  it('rejects coincident beacons — degenerate input would zero-divide', () => {
    expect(() => computeScaleFromBeacons({ x: 1, y: 2 }, { x: 1, y: 2 }, 5)).toThrow();
  });

  it('rejects non-finite coordinates', () => {
    expect(() => computeScaleFromBeacons({ x: Number.NaN, y: 0 }, { x: 10, y: 0 }, 5)).toThrow();
  });

  it('propagates the metres-validation error from computeScale', () => {
    expect(() => computeScaleFromBeacons({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toThrow();
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
