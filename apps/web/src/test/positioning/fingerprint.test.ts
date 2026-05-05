import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fingerprintMatch, MISSING_RSSI_FLOOR } from '@alzcare/shared/positioning';
import type { CalibrationPoint } from '@alzcare/shared/positioning';
import type { BleSample, WifiSample } from '@alzcare/shared/mqtt';

function calibration(
  id: string,
  x: number,
  y: number,
  ble: { mac: string; rssi_mean: number }[] = [],
  wifi: { bssid: string; rssi_mean: number }[] = [],
): CalibrationPoint {
  return {
    id,
    floor_plan_id: 'fp-1',
    x_canvas: x,
    y_canvas: y,
    ble_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: ble.map((b) => ({
        mac: b.mac,
        rssi_mean: b.rssi_mean,
        rssi_stddev: 1,
        sample_count: 30,
      })),
      quality: {
        sample_count_total: ble.length * 30,
        ble_count: ble.length * 30,
        wifi_count: 0,
        window_ms: 5000,
      },
    },
    wifi_signature: {
      captured_at: '2026-05-05T00:00:00Z',
      samples: wifi.map((w) => ({
        bssid: w.bssid,
        rssi_mean: w.rssi_mean,
        rssi_stddev: 1,
        sample_count: 30,
      })),
      quality: {
        sample_count_total: wifi.length * 30,
        ble_count: 0,
        wifi_count: wifi.length * 30,
        window_ms: 5000,
      },
    },
    captured_at: '2026-05-05T00:00:00Z',
  };
}

describe('fingerprintMatch', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('returns null when calibration corpus is empty', () => {
    const obs = { ble: [{ mac: 'AA:01', rssi: -55 }], wifi: [] };
    expect(fingerprintMatch(obs, [])).toBeNull();
  });

  it('returns null when k < 1', () => {
    expect(fingerprintMatch({ ble: [], wifi: [] }, [calibration('c-1', 0, 0)], 0)).toBeNull();
  });

  it('returns the calibration coords for a perfect match', () => {
    const cal = calibration('c-1', 100, 200, [
      { mac: 'AA:01', rssi_mean: -55 },
      { mac: 'AA:02', rssi_mean: -65 },
    ]);
    const obs: { ble: BleSample[]; wifi: WifiSample[] } = {
      ble: [
        { mac: 'AA:01', rssi: -55 },
        { mac: 'AA:02', rssi: -65 },
      ],
      wifi: [],
    };
    const result = fingerprintMatch(obs, [cal]);
    expect(result).not.toBeNull();
    expect(result!.x_canvas).toBe(100);
    expect(result!.y_canvas).toBe(200);
    expect(result!.k_distance).toBe(0);
  });

  it('weighted-average across kNN biases toward the closest match', () => {
    // Two calibrations equidistant in canvas, but signature distances
    // are wildly different — closer match should dominate.
    const calA = calibration('c-A', 0, 0, [{ mac: 'AA:01', rssi_mean: -55 }]);
    const calB = calibration('c-B', 1000, 1000, [{ mac: 'AA:01', rssi_mean: -90 }]);
    const obs = { ble: [{ mac: 'AA:01', rssi: -55 }], wifi: [] };
    const result = fingerprintMatch(obs, [calA, calB]);
    expect(result).not.toBeNull();
    // Should be close to (0, 0) — the perfect match dominates the weighted avg.
    expect(result!.x_canvas).toBeLessThan(50);
    expect(result!.y_canvas).toBeLessThan(50);
  });

  it('uses MISSING_RSSI_FLOOR as the absent-side substitute (penalises sparse matches)', () => {
    // Calibration knows about AA:01 strongly; observation only sees AA:02.
    // The missing-entry penalty must register; the match should be
    // distant.
    const cal = calibration('c-1', 100, 200, [{ mac: 'AA:01', rssi_mean: -55 }]);
    const obs: { ble: BleSample[]; wifi: WifiSample[] } = {
      ble: [{ mac: 'AA:02', rssi: -55 }],
      wifi: [],
    };
    const result = fingerprintMatch(obs, [cal]);
    expect(result).not.toBeNull();
    // The k-distance must reflect the symmetric penalty: cal sees AA:01
    // at -55 vs obs missing (-100) → 45² ; obs sees AA:02 at -55 vs cal
    // missing (-100) → 45². Total = sqrt(2 * 45²) = ~63.6.
    expect(result!.k_distance).toBeGreaterThan(60);
    expect(result!.k_distance).toBeLessThan(66);
    expect(MISSING_RSSI_FLOOR).toBe(-100);
  });

  it('skips stub-empty calibrations with a warn', () => {
    const calStub = calibration('stub', 999, 999); // empty samples both sides
    const calReal = calibration('real', 100, 200, [{ mac: 'AA:01', rssi_mean: -55 }]);
    const obs = { ble: [{ mac: 'AA:01', rssi: -55 }], wifi: [] };
    const result = fingerprintMatch(obs, [calStub, calReal]);
    expect(result).not.toBeNull();
    // Should land on the real calibration's (100, 200), not pulled
    // toward the stub's (999, 999).
    expect(result!.x_canvas).toBe(100);
    expect(result!.y_canvas).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null when every calibration is stub-empty', () => {
    expect(
      fingerprintMatch({ ble: [], wifi: [] }, [calibration('s-1', 0, 0), calibration('s-2', 0, 0)]),
    ).toBeNull();
  });

  it('blends BLE and WiFi distances into one combined match', () => {
    const cal = calibration(
      'c-1',
      100,
      200,
      [{ mac: 'AA:01', rssi_mean: -55 }],
      [{ bssid: 'BB:01', rssi_mean: -70 }],
    );
    const obs = {
      ble: [{ mac: 'AA:01', rssi: -55 }],
      wifi: [{ bssid: 'BB:01', rssi: -70 }],
    };
    const result = fingerprintMatch(obs, [cal]);
    expect(result).not.toBeNull();
    expect(result!.k_distance).toBe(0);
    expect(result!.x_canvas).toBe(100);
  });

  it('drops samples with non-finite RSSI from the observation', () => {
    const cal = calibration('c-1', 100, 200, [{ mac: 'AA:01', rssi_mean: -55 }]);
    const obs: { ble: BleSample[]; wifi: WifiSample[] } = {
      ble: [
        { mac: 'AA:01', rssi: Number.NaN },
        { mac: 'AA:01', rssi: -55 },
      ],
      wifi: [],
    };
    const result = fingerprintMatch(obs, [cal]);
    expect(result).not.toBeNull();
    expect(result!.k_distance).toBe(0);
  });
});
