/**
 * Calibration signature persisted in calibration_points.ble_signature and
 * calibration_points.wifi_signature. Written by F7's CaptureCoordinator;
 * read by F8's fingerprint matcher in Phase 3.
 *
 * Design choices:
 *   - One signature per modality (BLE, WiFi). Stored in two separate JSONB
 *     columns rather than a fused payload because they have different
 *     identifiers (mac vs. bssid) and different reliability characteristics.
 *     Phase 3 fingerprint matching weights them independently.
 *   - Stored as a flat array of samples, not a map keyed by id, because a
 *     beacon may be observed once or many times within the window. The flat
 *     shape lets F8 add per-sample provenance fields later without
 *     restructuring.
 *   - `quality` is the cheap summary the dashboard renders without
 *     re-aggregating; it must reflect what was actually written.
 *   - `captured_at` is ISO 8601 UTC per CROSS_CUTTING §5. The DB also stores
 *     `captured_at timestamptz default now()` on the row; the JSONB copy
 *     simplifies replay tooling that reads only the JSONB.
 */
export interface BleSignatureSample {
  /** BLE MAC address; matches beacons.mac_address when paired. */
  mac: string;
  /** Mean RSSI in dBm over the capture window. */
  rssi_mean: number;
  /** Standard deviation in dB; quality proxy. */
  rssi_stddev: number;
  /** Number of raw samples that contributed to this entry. */
  sample_count: number;
}

export interface WifiSignatureSample {
  /** WiFi BSSID. */
  bssid: string;
  /** Optional human-readable SSID at capture time. Not used for matching. */
  ssid?: string;
  rssi_mean: number;
  rssi_stddev: number;
  sample_count: number;
}

export interface SignatureQuality {
  /** Total raw samples across BLE + WiFi during the capture window. */
  sample_count_total: number;
  ble_count: number;
  wifi_count: number;
  /** Capture window in milliseconds — the *actual* observed window, not
   *  the requested one. A capture aborted at 7 s reports ~7000. */
  window_ms: number;
}

export interface CalibrationSignature<TSample = BleSignatureSample | WifiSignatureSample> {
  /** ISO 8601 UTC. */
  captured_at: string;
  samples: TSample[];
  quality: SignatureQuality;
}

/** Concrete aliases used at write / read time for clarity. */
export type BleCalibrationSignature = CalibrationSignature<BleSignatureSample>;
export type WifiCalibrationSignature = CalibrationSignature<WifiSignatureSample>;

import type { SignalsMessage } from '../mqtt/signals.ts';

// ─── F8: indoor positioning pipeline types ────────────────────────────
//
// The positioning pipeline is a chain of pure functions consumed by the
// `position_estimator` edge function. Inputs come from the realtime
// signals broadcast (live RSSI, no aggregation) and the DB (placed
// beacons, calibration points written by F7, recent estimates for
// smoothing + mode hysteresis). Output is a single `position_estimates`
// row.
//
// `BleSample` / `WifiSample` (live observations) are upstream in
// `@alzcare/shared/mqtt/signals` — they carry instantaneous RSSI, not
// the aggregated F7 shape above. Don't confuse the two: an observation
// is one tick; a calibration is the per-window aggregate.

/** A row from `public.beacons` as the pipeline needs to read it. Mirrors
 *  the DB shape; nullable fields encode "not yet placed" or "not yet
 *  calibrated". Beacons with null `x_canvas` / `y_canvas` are dropped
 *  before trilateration; beacons with null `rssi_at_1m` get
 *  DEFAULT_RSSI_AT_1M substituted (see pathLoss.ts). */
export interface BeaconRow {
  id: string;
  patient_id: string;
  floor_plan_id: string | null;
  mac_address: string;
  x_canvas: number | null;
  y_canvas: number | null;
  tx_power: number | null;
  rssi_at_1m: number | null;
}

/** A calibration point as the pipeline needs to read it. The signature
 *  payloads are F7's wire shape verbatim — fingerprint.ts reads
 *  `cal.ble_signature.samples` (not `cal.ble_signature` directly). */
export interface CalibrationPoint {
  id: string;
  floor_plan_id: string;
  x_canvas: number;
  y_canvas: number;
  ble_signature: BleCalibrationSignature;
  wifi_signature: WifiCalibrationSignature;
  captured_at: string;
}

/** One beacon's contribution to trilateration: where it sits + how far
 *  away the patient is, derived from the path-loss model. */
export interface BeaconDistance {
  beacon_id: string;
  x_canvas: number;
  y_canvas: number;
  rssi: number;
  distance_m: number;
}

export interface TrilaterationResult {
  x_canvas: number;
  y_canvas: number;
  /** RMS distance error of the recovered position against the three
   *  measured distances, in metres. Used by fuse.ts for confidence
   *  weighting. Higher residual = lower confidence. */
  residual_m: number;
}

export interface FingerprintResult {
  x_canvas: number;
  y_canvas: number;
  /** RSSI-space distance to the k-th neighbour. Lower = closer match
   *  to a calibrated point. Used by fuse.ts for confidence weighting. */
  k_distance: number;
}

export interface FusedResult {
  x_canvas: number;
  y_canvas: number;
  /** Weighted-blend confidence in [0, 1]. Higher when both trilateration
   *  and fingerprinting agree with low residual / k-distance. */
  fused_confidence: number;
}

export interface SmoothedResult {
  x_canvas: number;
  y_canvas: number;
  /** Distance from the most recent prior estimate, in metres. Cold-start
   *  ticks (no history) report 0. Used by confidence.ts to penalise
   *  jumpy outputs. */
  jump_m: number;
}

/** Subset of `position_estimates` rows the pipeline reads for smoothing
 *  and mode hysteresis. Defined here independently of the web app's
 *  `PositionEstimateRow` so `packages/shared` doesn't depend on
 *  `apps/web`.
 *
 *  POS-08 fields:
 *  - `indoor_confidence` is the per-tick indoor candidate confidence
 *    written by the orchestrator. Used to detect "indoor-weak" runs.
 *  - `gps_strong` is the per-tick "GPS satisfies hdop + fix_age" flag.
 *    Together these let `decideMode` count consecutive matching
 *    candidates without re-running the upstream stages.
 *  Both columns are nullable on rows written before the migration; the
 *  hysteresis check treats null as "no candidate evidence either way"
 *  and degrades gracefully. */
export interface RecentEstimate {
  recorded_at: string;
  mode: 'indoor' | 'outdoor';
  x_canvas: number | null;
  y_canvas: number | null;
  confidence: number | null;
  indoor_confidence: number | null;
  gps_strong: boolean | null;
}

export interface PositionPipelineInput {
  signals: SignalsMessage;
  beacons: BeaconRow[];
  calibrationPoints: CalibrationPoint[];
  /** Last 6 estimates for the patient, descending by recorded_at. The
   *  smoothing stage uses up to the first 5; the mode-hysteresis stage
   *  uses the same window. */
  recentEstimates: RecentEstimate[];
  scaleMetersPerPixel: number;
  /** Path-loss exponent. Default 2.0 (free space); tunable per
   *  environment. Future floor_plans column. */
  pathLossExponent?: number;
}

export interface PositionPipelineOutput {
  recorded_at: string;
  mode: 'indoor' | 'outdoor';
  x_canvas: number | null;
  y_canvas: number | null;
  lat: number | null;
  lng: number | null;
  confidence: number;
  /** POS-08: per-tick candidate fields that the orchestrator persists
   *  alongside `mode` so the next invocation can apply hysteresis on
   *  the *candidate* signal, not the *applied* mode. */
  indoor_confidence: number;
  gps_strong: boolean;
}
