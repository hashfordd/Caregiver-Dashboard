import { describe, it, expect } from 'vitest';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import {
  EXTENDED_WINDOW_MS,
  INITIAL_WINDOW_MS,
  MAX_STDDEV_DB,
  MIN_SAMPLES_TOTAL,
  accumulateSample,
  createAggregatorState,
  evaluateQuality,
  finaliseSignature,
} from '@/features/calibration/calibrationAggregator';

const PATIENT = '11111111-1111-1111-1111-111111111111';
const DEVICE = '22222222-2222-2222-2222-222222222222';

/** Seeded LCG so the random distributions are deterministic. Park-Miller
 *  multiplicative — small, dep-free, sufficient for unit tests. */
function rng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** Box–Muller transform on top of an LCG to draw N(mean, stddev). */
function gaussian(rand: () => number, mean: number, stddev: number): number {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stddev * z;
}

function bleMessage(samples: { mac: string; rssi: number }[]): SignalsMessage {
  return {
    v: 1,
    patient_id: PATIENT,
    device_id: DEVICE,
    recorded_at: '2026-05-05T12:00:00Z',
    ble: samples,
    wifi: [],
  };
}

describe('calibrationAggregator', () => {
  it('mean within ±0.5 dBm and stddev within ±1 dB for a generated N(-58, 2) distribution', () => {
    const rand = rng(42);
    const state = createAggregatorState();
    // 60 samples drawn from N(-58, 2) — F7.md acceptance test.
    for (let i = 0; i < 60; i++) {
      accumulateSample(
        state,
        bleMessage([{ mac: 'aa:bb:cc:dd:ee:01', rssi: gaussian(rand, -58, 2) }]),
      );
    }
    const { ble } = finaliseSignature(state, 6_000, '2026-05-05T12:00:06.000Z');
    expect(ble.samples).toHaveLength(1);
    expect(ble.samples[0]!.mac).toBe('aa:bb:cc:dd:ee:01');
    expect(ble.samples[0]!.sample_count).toBe(60);
    expect(Math.abs(ble.samples[0]!.rssi_mean - -58)).toBeLessThan(0.5);
    expect(Math.abs(ble.samples[0]!.rssi_stddev - 2)).toBeLessThan(1);
    expect(ble.quality.window_ms).toBe(6_000);
    expect(ble.quality.sample_count_total).toBe(60);
  });

  it('aggregates three independent BLE distributions with the right per-MAC stats', () => {
    const rand = rng(123);
    const state = createAggregatorState();
    const macs = [
      { mac: 'aa:bb:cc:dd:ee:01', mean: -55, stddev: 2 },
      { mac: 'aa:bb:cc:dd:ee:02', mean: -65, stddev: 3 },
      { mac: 'aa:bb:cc:dd:ee:03', mean: -75, stddev: 1.5 },
    ];
    // 60 ticks; each tick observes all three MACs.
    for (let i = 0; i < 60; i++) {
      accumulateSample(
        state,
        bleMessage(macs.map((m) => ({ mac: m.mac, rssi: gaussian(rand, m.mean, m.stddev) }))),
      );
    }
    const { ble } = finaliseSignature(state, 6_000);
    expect(ble.samples).toHaveLength(3);
    // Sorted strongest-first.
    expect(ble.samples.map((s) => s.mac)).toEqual([
      'aa:bb:cc:dd:ee:01',
      'aa:bb:cc:dd:ee:02',
      'aa:bb:cc:dd:ee:03',
    ]);
    for (const sample of ble.samples) {
      const expected = macs.find((m) => m.mac === sample.mac)!;
      expect(Math.abs(sample.rssi_mean - expected.mean)).toBeLessThan(0.7);
      expect(Math.abs(sample.rssi_stddev - expected.stddev)).toBeLessThan(1);
      expect(sample.sample_count).toBe(60);
    }
  });

  it('handles empty wifi arrays without crashing and reports wifi_count = 0', () => {
    const state = createAggregatorState();
    accumulateSample(state, bleMessage([{ mac: 'aa:bb:cc:dd:ee:01', rssi: -55 }]));
    const { wifi, ble } = finaliseSignature(state, 1_000);
    expect(wifi.samples).toEqual([]);
    expect(wifi.quality.wifi_count).toBe(0);
    expect(ble.quality.wifi_count).toBe(0);
  });

  it('records the latest SSID per BSSID when present', () => {
    const state = createAggregatorState();
    const msg = (ssid: string | undefined, rssi: number): SignalsMessage => ({
      v: 1,
      patient_id: PATIENT,
      device_id: DEVICE,
      recorded_at: '2026-05-05T12:00:00Z',
      ble: [],
      wifi: [{ bssid: '00:11:22:33:44:55', ssid, rssi }],
    });
    accumulateSample(state, msg('OldName', -70));
    accumulateSample(state, msg('NewName', -71));
    accumulateSample(state, msg(undefined, -72));
    const { wifi } = finaliseSignature(state, 1_000);
    expect(wifi.samples).toHaveLength(1);
    // Most recent observation that included an SSID wins ('NewName').
    expect(wifi.samples[0]!.ssid).toBe('NewName');
    expect(wifi.samples[0]!.sample_count).toBe(3);
  });

  it('tolerates non-finite RSSI values (drops them silently)', () => {
    const state = createAggregatorState();
    accumulateSample(state, bleMessage([{ mac: 'aa:bb:cc:dd:ee:01', rssi: Number.NaN }]));
    accumulateSample(
      state,
      bleMessage([{ mac: 'aa:bb:cc:dd:ee:01', rssi: Number.POSITIVE_INFINITY }]),
    );
    accumulateSample(state, bleMessage([{ mac: 'aa:bb:cc:dd:ee:01', rssi: -55 }]));
    const { ble } = finaliseSignature(state, 1_000);
    expect(ble.samples).toHaveLength(1);
    expect(ble.samples[0]!.sample_count).toBe(1);
    expect(ble.samples[0]!.rssi_mean).toBe(-55);
  });

  it('records MACs the aggregator has never been told about beacon-wise (orphan tolerance)', () => {
    // Captures what was observed; F8 tolerates orphan MACs. The
    // aggregator does NOT filter against a beacons list — that's a
    // deliberate spec contract restated in F7.md "beacon set drift".
    const state = createAggregatorState();
    accumulateSample(state, bleMessage([{ mac: 'unpaired:mac', rssi: -65 }]));
    const { ble } = finaliseSignature(state, 1_000);
    expect(ble.samples.map((s) => s.mac)).toContain('unpaired:mac');
  });
});

describe('evaluateQuality', () => {
  function bleSig(macs: { mac: string; rssi_mean: number; rssi_stddev: number; count: number }[]) {
    return {
      captured_at: '2026-05-05T12:00:00.000Z',
      samples: macs.map((m) => ({
        mac: m.mac,
        rssi_mean: m.rssi_mean,
        rssi_stddev: m.rssi_stddev,
        sample_count: m.count,
      })),
      quality: {
        sample_count_total: macs.reduce((acc, m) => acc + m.count, 0),
        ble_count: macs.reduce((acc, m) => acc + m.count, 0),
        wifi_count: 0,
        window_ms: 5_000,
      },
    };
  }
  function emptyWifi() {
    return {
      captured_at: '2026-05-05T12:00:00.000Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 5_000 },
    };
  }

  it('passes when sample count is high and stddev is bounded', () => {
    const ble = bleSig([
      { mac: 'a', rssi_mean: -55, rssi_stddev: 2, count: 20 },
      { mac: 'b', rssi_mean: -65, rssi_stddev: 3, count: 20 },
    ]);
    expect(evaluateQuality(ble, emptyWifi())).toEqual({ ok: true });
  });

  it('rejects with sample_count_below_threshold when below the floor', () => {
    const ble = bleSig([{ mac: 'a', rssi_mean: -55, rssi_stddev: 2, count: 12 }]);
    expect(evaluateQuality(ble, emptyWifi())).toEqual({
      ok: false,
      reason: 'sample_count_below_threshold',
    });
    expect(MIN_SAMPLES_TOTAL).toBe(30);
  });

  it('rejects with unstable_signal when any of the top-3 BLE stddev exceeds the cap', () => {
    const ble = bleSig([
      // Three strong beacons, the second one too noisy (>8 dB).
      { mac: 'a', rssi_mean: -55, rssi_stddev: 2, count: 12 },
      { mac: 'b', rssi_mean: -60, rssi_stddev: 14, count: 12 },
      { mac: 'c', rssi_mean: -70, rssi_stddev: 1.5, count: 12 },
    ]);
    expect(evaluateQuality(ble, emptyWifi())).toEqual({
      ok: false,
      reason: 'unstable_signal',
    });
    expect(MAX_STDDEV_DB).toBe(8);
  });

  it('ignores stddev outside the top-3 (a 4th-strongest beacon may be flaky without rejection)', () => {
    const ble = bleSig([
      { mac: 'a', rssi_mean: -55, rssi_stddev: 2, count: 8 },
      { mac: 'b', rssi_mean: -60, rssi_stddev: 2, count: 8 },
      { mac: 'c', rssi_mean: -65, rssi_stddev: 2, count: 8 },
      { mac: 'd', rssi_mean: -90, rssi_stddev: 12, count: 6 },
    ]);
    expect(evaluateQuality(ble, emptyWifi())).toEqual({ ok: true });
  });

  it('rejects with no_signals when nothing was observed', () => {
    expect(
      evaluateQuality(
        {
          captured_at: '2026-05-05T12:00:00.000Z',
          samples: [],
          quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 5_000 },
        },
        emptyWifi(),
      ),
    ).toEqual({ ok: false, reason: 'no_signals' });
  });
});

describe('window constants', () => {
  it('exposes the documented 5 / 10 s window thresholds', () => {
    expect(INITIAL_WINDOW_MS).toBe(5_000);
    expect(EXTENDED_WINDOW_MS).toBe(10_000);
  });
});
