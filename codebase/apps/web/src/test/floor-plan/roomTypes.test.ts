import { describe, it, expect } from 'vitest';
import { parsePolygonText, polygonToText } from '@/features/floor-plan/roomTypes';

describe('parsePolygonText', () => {
  it('parses comma-separated "x, y" lines', () => {
    const result = parsePolygonText('100, 100\n400, 100\n400, 300\n100, 300');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.polygon).toEqual([
        [100, 100],
        [400, 100],
        [400, 300],
        [100, 300],
      ]);
    }
  });

  it('parses whitespace-separated values too', () => {
    const result = parsePolygonText('0 0\n10 0\n5 8');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.polygon).toHaveLength(3);
  });

  it('ignores blank lines and # comments', () => {
    const text = '# room outline\n0, 0\n\n100, 0\n\n50, 80 # apex';
    const result = parsePolygonText(text);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.polygon).toEqual([
        [0, 0],
        [100, 0],
        [50, 80],
      ]);
  });

  it('rejects fewer than 3 vertices', () => {
    const result = parsePolygonText('0, 0\n10, 10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least 3/);
  });

  it('reports the 1-based line number on a malformed entry', () => {
    const result = parsePolygonText('0, 0\nNaN, 5\n10, 10');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.line).toBe(2);
      expect(result.error).toMatch(/must be numbers/);
    }
  });

  it('reports when a line has the wrong number of values', () => {
    const result = parsePolygonText('0, 0\n1, 2, 3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.line).toBe(2);
      expect(result.error).toMatch(/3 values/);
    }
  });

  it('round-trips through polygonToText', () => {
    const input: [number, number][] = [
      [10, 20],
      [30, 40],
      [50, 60],
    ];
    const text = polygonToText(input);
    const result = parsePolygonText(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.polygon).toEqual(input);
  });
});
