// F7 calibration aggregator. Pure functions — no React, no fetching, no
// canvas. Drives the running statistics for one capture window.
//
// Strategy: Welford's online algorithm for mean + variance, keyed by
// MAC (BLE) and BSSID (WiFi). The state is O(distinct identifiers), not
// O(samples), so a 5–10 s window costs a handful of bytes regardless of
// signal rate. finaliseSignature returns the per-modality
// CalibrationSignature in the wire shape persisted as JSONB on
// calibration_points.

import type { SignalsMessage } from '@alzcare/shared/mqtt';
import type {
  BleCalibrationSignature,
  BleSignatureSample,
  WifiCalibrationSignature,
  WifiSignatureSample,
} from '@alzcare/shared/positioning';

// Quality thresholds locked here as named exports so tests reference
// them by name (avoids drift between test fixtures and runtime).
export const MIN_SAMPLES_TOTAL = 30;
export const MAX_STDDEV_DB = 8;
export const STDDEV_TOP_N = 3;
export const INITIAL_WINDOW_MS = 5_000;
export const EXTENDED_WINDOW_MS = 10_000;

interface RunningStats {
  count: number;
  mean: number;
  /** Welford's M2 — sum of squared deltas. variance = M2 / (count - 1). */
  m2: number;
}

/** Per-MAC/BSSID running state plus a `latestSsid` for WiFi (the SSID
 *  may change across samples; we keep the most recent observation). */
export interface AggregatorState {
  ble: Map<string, RunningStats>;
  wifi: Map<string, RunningStats & { latestSsid?: string }>;
}

export function createAggregatorState(): AggregatorState {
  return { ble: new Map(), wifi: new Map() };
}

/** Fold one validated SignalsMessage into the running state. Empty
 *  ble/wifi arrays are no-ops; callers can pass any shape and trust this
 *  function not to throw. */
export function accumulateSample(state: AggregatorState, msg: SignalsMessage): void {
  for (const sample of msg.ble) {
    if (!Number.isFinite(sample.rssi)) continue;
    pushStat(state.ble, sample.mac, sample.rssi);
  }
  for (const sample of msg.wifi) {
    if (!Number.isFinite(sample.rssi)) continue;
    const stats = pushStat(state.wifi, sample.bssid, sample.rssi) as RunningStats & {
      latestSsid?: string;
    };
    if (sample.ssid !== undefined) stats.latestSsid = sample.ssid;
  }
}

function pushStat<T extends RunningStats>(map: Map<string, T>, key: string, value: number): T {
  let stats = map.get(key);
  if (!stats) {
    stats = { count: 0, mean: 0, m2: 0 } as T;
    map.set(key, stats);
  }
  // Welford's online update.
  stats.count += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
  return stats;
}

function stddev(stats: RunningStats): number {
  if (stats.count < 2) return 0;
  return Math.sqrt(stats.m2 / (stats.count - 1));
}

/** Snapshot the running state into the JSONB-friendly signature shape.
 *  `windowMs` is the *actual* observed elapsed window (not the
 *  requested window). */
export function finaliseSignature(
  state: AggregatorState,
  windowMs: number,
  capturedAt: string = new Date().toISOString(),
): { ble: BleCalibrationSignature; wifi: WifiCalibrationSignature } {
  const bleSamples: BleSignatureSample[] = [];
  let bleTotal = 0;
  for (const [mac, stats] of state.ble) {
    bleSamples.push({
      mac,
      rssi_mean: roundTo(stats.mean, 2),
      rssi_stddev: roundTo(stddev(stats), 2),
      sample_count: stats.count,
    });
    bleTotal += stats.count;
  }
  const wifiSamples: WifiSignatureSample[] = [];
  let wifiTotal = 0;
  for (const [bssid, stats] of state.wifi) {
    wifiSamples.push({
      bssid,
      ...(stats.latestSsid !== undefined && { ssid: stats.latestSsid }),
      rssi_mean: roundTo(stats.mean, 2),
      rssi_stddev: roundTo(stddev(stats), 2),
      sample_count: stats.count,
    });
    wifiTotal += stats.count;
  }
  // Sort BLE strongest-first so the dashboard's "top 3 stddev" check is
  // a slice off the front; same order also makes the JSONB read in the
  // Supabase studio more useful.
  bleSamples.sort((a, b) => b.rssi_mean - a.rssi_mean);
  wifiSamples.sort((a, b) => b.rssi_mean - a.rssi_mean);
  const total = bleTotal + wifiTotal;
  return {
    ble: {
      captured_at: capturedAt,
      samples: bleSamples,
      quality: {
        sample_count_total: total,
        ble_count: bleTotal,
        wifi_count: wifiTotal,
        window_ms: windowMs,
      },
    },
    wifi: {
      captured_at: capturedAt,
      samples: wifiSamples,
      quality: {
        sample_count_total: total,
        ble_count: bleTotal,
        wifi_count: wifiTotal,
        window_ms: windowMs,
      },
    },
  };
}

export type QualityResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'sample_count_below_threshold' | 'unstable_signal' | 'no_signals';
    };

/** Verify the signature meets the F7 acceptance thresholds. Run AFTER
 *  finaliseSignature — the BLE signature is the source of truth here
 *  because positioning fingerprint matching relies on it; WiFi is
 *  belt-and-braces. */
export function evaluateQuality(
  ble: BleCalibrationSignature,
  wifi: WifiCalibrationSignature,
): QualityResult {
  const total = ble.quality.sample_count_total;
  if (total === 0 && ble.samples.length === 0 && wifi.samples.length === 0) {
    return { ok: false, reason: 'no_signals' };
  }
  if (total < MIN_SAMPLES_TOTAL) {
    return { ok: false, reason: 'sample_count_below_threshold' };
  }
  // Top-N strongest BLE beacons (already sorted by rssi_mean desc in
  // finaliseSignature). When fewer than N are observed, evaluate what's
  // there — a 1-beacon fingerprint is unusual but not invalid.
  const top = ble.samples.slice(0, STDDEV_TOP_N);
  // Item 127: require each top-N BLE entry to have at least 4 samples
  // before evaluating stddev. stddev() returns 0 when count < 2, which
  // the prior implementation treated as "stable" — silently letting a
  // capture with WiFi-dominant samples + 1-sample BLE entries pass as
  // "ok". Fingerprint matching needs more than one observation per BLE
  // peer to be useful.
  const MIN_BLE_SAMPLES_PER_ENTRY = 4;
  if (top.some((s) => s.sample_count < MIN_BLE_SAMPLES_PER_ENTRY)) {
    return { ok: false, reason: 'unstable_signal' };
  }
  if (top.some((s) => s.rssi_stddev > MAX_STDDEV_DB)) {
    return { ok: false, reason: 'unstable_signal' };
  }
  return { ok: true };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
