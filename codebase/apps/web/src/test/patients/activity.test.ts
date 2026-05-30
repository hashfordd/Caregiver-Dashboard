import { describe, expect, it } from 'vitest';
import {
  classifyActivity,
  magnitudeDeviationG,
  nextActivitySince,
  REST_DEV_G,
  REST_GYRO_DPS,
} from '@/lib/activity';

describe('magnitudeDeviationG', () => {
  it('is zero at 1 g rest and absolute either side', () => {
    expect(magnitudeDeviationG(1)).toBe(0);
    expect(magnitudeDeviationG(1.2)).toBeCloseTo(0.2);
    expect(magnitudeDeviationG(0.85)).toBeCloseTo(0.15);
  });
});

describe('classifyActivity', () => {
  it('rests when both deviation and rotation are below the rest thresholds', () => {
    expect(classifyActivity(0.02, 5)).toBe('resting');
    expect(classifyActivity(0, 0)).toBe('resting');
  });

  it('treats the rest thresholds as strict upper bounds', () => {
    // Exactly at REST_DEV_G is no longer resting.
    expect(classifyActivity(REST_DEV_G, 5)).toBe('light');
    expect(classifyActivity(0.02, REST_GYRO_DPS)).toBe('light');
  });

  it('is light for moderate deviation or rotation under the light thresholds', () => {
    expect(classifyActivity(0.2, 10)).toBe('light');
    expect(classifyActivity(0.05, 60)).toBe('light');
  });

  it('is active when deviation or rotation crosses the light thresholds', () => {
    expect(classifyActivity(0.4, 10)).toBe('active');
    expect(classifyActivity(0.1, 120)).toBe('active');
    expect(classifyActivity(1.5, 300)).toBe('active');
  });
});

describe('nextActivitySince', () => {
  it('starts the clock on the first reading', () => {
    expect(nextActivitySince(null, null, 'resting', 1000)).toBe(1000);
  });

  it('carries the start forward while the state is unchanged', () => {
    expect(nextActivitySince('resting', 1000, 'resting', 5000)).toBe(1000);
  });

  it('resets to the new reading time when the state flips', () => {
    expect(nextActivitySince('resting', 1000, 'active', 5000)).toBe(5000);
  });

  it('resets when there is no prior start even if the state matches', () => {
    expect(nextActivitySince('resting', null, 'resting', 5000)).toBe(5000);
  });
});
