import { describe, it, expect } from 'vitest';
import { formatDistance, haversineMetres } from '@/features/map/distance';

describe('haversineMetres', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: -37.8136, lng: 144.9631 };
    expect(haversineMetres(p, p)).toBe(0);
  });

  it('symmetry: d(a, b) === d(b, a)', () => {
    const a = { lat: -37.8136, lng: 144.9631 };
    const b = { lat: -37.815, lng: 144.965 };
    expect(haversineMetres(a, b)).toBeCloseTo(haversineMetres(b, a), 6);
  });

  it('approximates 1° of latitude as ~111 km at the equator', () => {
    const m = haversineMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(m).toBeGreaterThan(111_000);
    expect(m).toBeLessThan(112_000);
  });

  it('matches the Melbourne CBD ↔ MCG ground-truth distance', () => {
    // Federation Square ↔ MCG is ~1.0 km on foot. Haversine ignores
    // bridges and walking paths; it just measures the straight line.
    const fedSquare = { lat: -37.8179, lng: 144.969 };
    const mcg = { lat: -37.82, lng: 144.9834 };
    const m = haversineMetres(fedSquare, mcg);
    expect(m).toBeGreaterThan(1_200);
    expect(m).toBeLessThan(1_400);
  });
});

describe('formatDistance', () => {
  it('rounds metres under 1 km', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(234.6)).toBe('235 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('flips to km at the 1 km mark with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(2456)).toBe('2.5 km');
    expect(formatDistance(9999)).toBe('10.0 km');
  });

  it('drops the decimal past 10 km', () => {
    expect(formatDistance(10001)).toBe('10 km');
    expect(formatDistance(15400)).toBe('15 km');
  });

  it('returns an em-dash for invalid input', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
    expect(formatDistance(Infinity)).toBe('—');
  });
});
