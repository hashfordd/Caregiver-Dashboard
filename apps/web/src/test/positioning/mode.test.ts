import { describe, it, expect } from 'vitest';
import { decideMode } from '@alzcare/shared/positioning';
import type { RecentEstimate } from '@alzcare/shared/positioning';
import type { GpsFix } from '@alzcare/shared/mqtt';

const STRONG_GPS: GpsFix = { lat: 0, lng: 0, hdop: 1.0, fix_age_s: 1 };
const WEAK_HDOP_GPS: GpsFix = { lat: 0, lng: 0, hdop: 5.0, fix_age_s: 1 };
const STALE_GPS: GpsFix = { lat: 0, lng: 0, hdop: 1.0, fix_age_s: 30 };

const NO_RECENT: RecentEstimate[] = [];

describe('decideMode (V1: candidate-only, no hysteresis)', () => {
  it('returns indoor when there is no GPS fix', () => {
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: undefined,
        indoorConfidence: 0.1,
      }),
    ).toBe('indoor');
  });

  it('returns indoor when GPS is present but hdop too high', () => {
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: WEAK_HDOP_GPS,
        indoorConfidence: 0.1,
      }),
    ).toBe('indoor');
  });

  it('returns indoor when GPS is present but fix_age_s too old', () => {
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: STALE_GPS,
        indoorConfidence: 0.1,
      }),
    ).toBe('indoor');
  });

  it('returns indoor when GPS is strong but indoor confidence is also strong', () => {
    // The patient is somewhere with line-of-sight to a satellite (eg. a
    // window-side room) but the BLE/WiFi fingerprint is solid. We
    // should keep them on the floor plan.
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: STRONG_GPS,
        indoorConfidence: 0.9,
      }),
    ).toBe('indoor');
  });

  it('returns outdoor when GPS is strong AND indoor confidence is weak', () => {
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: STRONG_GPS,
        indoorConfidence: 0.1,
      }),
    ).toBe('outdoor');
  });

  it('treats GPS without hdop / fix_age_s as not-strong (defensive defaults)', () => {
    const noQuality: GpsFix = { lat: 0, lng: 0 };
    expect(
      decideMode({
        recentEstimates: NO_RECENT,
        gpsFix: noQuality,
        indoorConfidence: 0.1,
      }),
    ).toBe('indoor');
  });
});
