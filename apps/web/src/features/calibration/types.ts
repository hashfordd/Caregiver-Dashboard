// Local types for the F7 calibration workflow. The CalibrationSignature
// shape itself is locked in @alzcare/shared/positioning so F8's
// fingerprint matcher can read what F7 writes.

import type {
  BleCalibrationSignature,
  WifiCalibrationSignature,
} from '@alzcare/shared/positioning';

export interface CalibrationPointRow {
  id: string;
  floor_plan_id: string;
  x_canvas: number;
  y_canvas: number;
  ble_signature: BleCalibrationSignature;
  wifi_signature: WifiCalibrationSignature;
  captured_at: string;
}

export interface CaptureCalibrationPointInput {
  floor_plan_id: string;
  x_canvas: number;
  y_canvas: number;
  ble_signature: BleCalibrationSignature;
  wifi_signature: WifiCalibrationSignature;
}
