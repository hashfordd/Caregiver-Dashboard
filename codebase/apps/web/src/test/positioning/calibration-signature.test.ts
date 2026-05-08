import { describe, it, expect } from 'vitest';
import type {
  BleCalibrationSignature,
  WifiCalibrationSignature,
} from '@alzcare/shared/positioning';

describe('CalibrationSignature shape', () => {
  it('round-trips through JSON.stringify/parse — JSONB-friendly', () => {
    // Locked here in slice 1 so a downstream change to the type that breaks
    // serialisation (e.g. Date / Map / Set) gets caught at PR time, not in
    // production after the next migration runs.
    const ble: BleCalibrationSignature = {
      captured_at: '2026-05-05T12:00:00.000Z',
      samples: [
        { mac: 'AA:BB:CC:DD:EE:01', rssi_mean: -55, rssi_stddev: 2.1, sample_count: 24 },
        { mac: 'AA:BB:CC:DD:EE:02', rssi_mean: -67, rssi_stddev: 1.8, sample_count: 22 },
      ],
      quality: { sample_count_total: 46, ble_count: 46, wifi_count: 0, window_ms: 5_120 },
    };
    const wifi: WifiCalibrationSignature = {
      captured_at: '2026-05-05T12:00:00.000Z',
      samples: [
        {
          bssid: '00:11:22:33:44:55',
          ssid: 'Home WiFi',
          rssi_mean: -71,
          rssi_stddev: 3.2,
          sample_count: 12,
        },
      ],
      quality: { sample_count_total: 12, ble_count: 0, wifi_count: 12, window_ms: 5_120 },
    };

    expect(JSON.parse(JSON.stringify(ble))).toEqual(ble);
    expect(JSON.parse(JSON.stringify(wifi))).toEqual(wifi);
  });

  it('round-trips a signature with empty samples (no observations during window)', () => {
    const empty: BleCalibrationSignature = {
      captured_at: '2026-05-05T12:00:00.000Z',
      samples: [],
      quality: { sample_count_total: 0, ble_count: 0, wifi_count: 0, window_ms: 0 },
    };
    expect(JSON.parse(JSON.stringify(empty))).toEqual(empty);
  });
});
