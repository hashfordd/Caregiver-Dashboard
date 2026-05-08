import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_PATH_LOSS_EXPONENT,
  DEFAULT_RSSI_AT_1M,
  __resetPathLossWarnings,
  pathLossDistance,
  rssiVectorToDistances,
} from '@alzcare/shared/positioning';
import type { BeaconRow } from '@alzcare/shared/positioning';
import type { BleSample } from '@alzcare/shared/mqtt';

describe('pathLossDistance', () => {
  it('returns 1 m exactly when observed RSSI equals rssi_at_1m', () => {
    expect(pathLossDistance(-59, -59)).toBeCloseTo(1, 9);
    expect(pathLossDistance(-65, -65, 2.5)).toBeCloseTo(1, 9);
  });

  it('doubles distance for the exact log-10 doubling RSSI delta at exponent 2.0', () => {
    // Doubling distance corresponds to a 20*log10(2) ≈ 6.0206 dB drop;
    // 6 dB is the rule-of-thumb shorthand. Use the exact value.
    const halvingDb = 10 * Math.log10(4); // 6.0206 dB → 2x; 12.0412 dB → 4x
    expect(pathLossDistance(-59 - halvingDb, -59, 2.0)).toBeCloseTo(2, 5);
    expect(pathLossDistance(-59 - 2 * halvingDb, -59, 2.0)).toBeCloseTo(4, 5);
  });

  it('uses the documented default exponent when omitted', () => {
    expect(pathLossDistance(-71, -59)).toBeCloseTo(
      pathLossDistance(-71, -59, DEFAULT_PATH_LOSS_EXPONENT),
      9,
    );
    expect(DEFAULT_PATH_LOSS_EXPONENT).toBe(2.0);
  });

  it('halves distance for the exact log-10 halving RSSI delta above rssi_at_1m', () => {
    const halvingDb = 10 * Math.log10(4);
    expect(pathLossDistance(-59 + halvingDb, -59, 2.0)).toBeCloseTo(0.5, 5);
  });

  it('produces larger distances at higher path-loss exponents (more attenuation)', () => {
    // At exp=1.8 free-er space; at exp=3.0 lots of obstruction. For the
    // same RSSI drop the recovered distance is bigger when exp is
    // smaller (less attenuation per metre).
    const at18 = pathLossDistance(-71, -59, 1.8);
    const at30 = pathLossDistance(-71, -59, 3.0);
    expect(at18).toBeGreaterThan(at30);
  });
});

describe('rssiVectorToDistances', () => {
  function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
    return {
      id: 'b-1',
      patient_id: 'p-1',
      floor_plan_id: 'fp-1',
      mac_address: 'AA:BB:CC:DD:EE:01',
      x_canvas: 100,
      y_canvas: 100,
      tx_power: null,
      rssi_at_1m: -59,
      ...overrides,
    };
  }

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Phase G item 57: dedup is now process-lifetime; reset between
    // tests so each starts from a clean slate.
    __resetPathLossWarnings();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('joins observation against beacons; produces one entry per heard, placed, calibrated beacon', () => {
    const beacons: BeaconRow[] = [
      beacon({ id: 'b-1', mac_address: 'AA:01' }),
      beacon({ id: 'b-2', mac_address: 'AA:02', x_canvas: 200, y_canvas: 100 }),
      beacon({ id: 'b-3', mac_address: 'AA:03', x_canvas: 200, y_canvas: 200 }),
    ];
    const halvingDb = 10 * Math.log10(4);
    const obs: BleSample[] = [
      { mac: 'AA:01', rssi: -59 },
      { mac: 'AA:02', rssi: -59 - halvingDb }, // 2 m
      { mac: 'AA:03', rssi: -59 - 2 * halvingDb }, // 4 m
    ];
    const out = rssiVectorToDistances(obs, beacons);
    expect(out).toHaveLength(3);
    expect(out[0]!.beacon_id).toBe('b-1');
    expect(out[0]!.distance_m).toBeCloseTo(1, 5);
    expect(out[1]!.distance_m).toBeCloseTo(2, 5);
    expect(out[2]!.distance_m).toBeCloseTo(4, 5);
  });

  it('skips beacons not present in the observation (not heard this tick)', () => {
    const beacons = [
      beacon({ id: 'b-1', mac_address: 'AA:01' }),
      beacon({ id: 'b-2', mac_address: 'AA:02' }),
    ];
    const obs: BleSample[] = [{ mac: 'AA:01', rssi: -59 }];
    const out = rssiVectorToDistances(obs, beacons);
    expect(out).toHaveLength(1);
    expect(out[0]!.beacon_id).toBe('b-1');
  });

  it('drops beacons without a placed canvas position', () => {
    const beacons = [
      beacon({ id: 'b-1', mac_address: 'AA:01', x_canvas: null }),
      beacon({ id: 'b-2', mac_address: 'AA:02', y_canvas: null }),
    ];
    const obs: BleSample[] = [
      { mac: 'AA:01', rssi: -59 },
      { mac: 'AA:02', rssi: -59 },
    ];
    expect(rssiVectorToDistances(obs, beacons)).toEqual([]);
  });

  it('substitutes DEFAULT_RSSI_AT_1M for null calibration and warns once per beacon', () => {
    const beacons = [
      beacon({ id: 'b-1', mac_address: 'AA:01', rssi_at_1m: null }),
      beacon({ id: 'b-2', mac_address: 'AA:02', rssi_at_1m: null }),
    ];
    const obs: BleSample[] = [
      { mac: 'AA:01', rssi: DEFAULT_RSSI_AT_1M },
      { mac: 'AA:02', rssi: DEFAULT_RSSI_AT_1M },
    ];
    const out = rssiVectorToDistances(obs, beacons);
    expect(out).toHaveLength(2);
    // RSSI === DEFAULT_RSSI_AT_1M → distance = 1 m.
    expect(out[0]!.distance_m).toBeCloseTo(1, 5);
    expect(out[1]!.distance_m).toBeCloseTo(1, 5);
    // One warn per distinct beacon id within the call.
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('Phase G item 57: dedup is process-lifetime — invoking twice for the same beacon warns once', () => {
    // The previous per-call dedup re-warned every tick at 1 Hz × N
    // beacons until F6 calibration UI lands. Now the warning fires at
    // most once per beacon for the run.
    const beacons = [beacon({ id: 'b-1', mac_address: 'AA:01', rssi_at_1m: null })];
    const obs: BleSample[] = [{ mac: 'AA:01', rssi: -59 }];
    rssiVectorToDistances(obs, beacons);
    rssiVectorToDistances(obs, beacons);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('drops samples with non-finite RSSI', () => {
    const beacons = [beacon({ mac_address: 'AA:01' })];
    const obs: BleSample[] = [
      { mac: 'AA:01', rssi: Number.NaN },
      { mac: 'AA:01', rssi: Number.POSITIVE_INFINITY },
    ];
    expect(rssiVectorToDistances(obs, beacons)).toEqual([]);
  });
});
