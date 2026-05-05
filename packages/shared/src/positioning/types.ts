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
