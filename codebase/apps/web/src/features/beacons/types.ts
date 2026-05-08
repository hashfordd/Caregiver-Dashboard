// Local types for the F6 beacon pairing & placement feature. Beacons are
// addressable entities (per CROSS_CUTTING §6) so they get their own table
// and React Query hooks rather than living inside floor_plans.canvas_json.

export interface BeaconRow {
  id: string;
  patient_id: string;
  floor_plan_id: string | null;
  mac_address: string;
  label: string | null;
  x_canvas: number | null;
  y_canvas: number | null;
  /** TODO: F8 / POS-02 — calibrated TX power per beacon. Null in F6. */
  tx_power: number | null;
  /** TODO: F8 / POS-02 — calibrated reference RSSI at 1m. Null in F6. */
  rssi_at_1m: number | null;
  created_at: string;
}

export interface UpsertBeaconInput {
  patient_id: string;
  floor_plan_id: string | null;
  mac_address: string;
  label: string;
}

export interface UpdateBeaconPositionInput {
  id: string;
  x_canvas: number;
  y_canvas: number;
}

/** A beacon is "placed" once both canvas coordinates are set. The list
 *  view shows an "(unplaced)" badge until then. */
export function isPlaced(b: BeaconRow): boolean {
  return b.x_canvas != null && b.y_canvas != null;
}
