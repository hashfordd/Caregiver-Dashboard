// F8 stage 1: RSSI → distance via the log-distance path-loss model.
//
//   distance_m = 10 ^ ((rssi_at_1m - rssi_observed) / (10 * exponent))
//
// `rssi_at_1m` is the calibrated reference RSSI for a beacon at 1 m,
// which F6 was meant to capture during pairing but doesn't yet (the UI
// flow is BACKLOGed). In its absence, the model substitutes
// DEFAULT_RSSI_AT_1M (-59 dBm — the iBeacon datasheet midpoint) and
// emits a one-time warning per call so the orchestrator can surface
// "calibration debt" in the F8 accuracy report.
//
// Pure functions only; no DB, no env reads.

import type { BleSample } from '../mqtt/signals.ts';
import type { BeaconDistance, BeaconRow } from './types.ts';

/** Free-space path-loss exponent. Real environments are 1.8–4.0
 *  depending on materials; 2.0 is a reasonable default for a small
 *  apartment with line-of-sight at ~5 m ranges. */
export const DEFAULT_PATH_LOSS_EXPONENT = 2.0;

/** Substitute used when `beacons.rssi_at_1m IS NULL`. iBeacon-class
 *  beacons typically read -55 to -65 dBm at 1 m; -59 splits the
 *  difference. The substitution is the single largest source of
 *  systematic error in the trilateration path until F6's beacon
 *  calibration UI lands — see BACKLOG. */
export const DEFAULT_RSSI_AT_1M = -59;

/** Solve the log-distance model for a single beacon-sample pair.
 *
 *  - rssi: observed RSSI in dBm (negative).
 *  - rssi1m: the beacon's reference RSSI at 1 m (also negative).
 *  - exponent: path-loss exponent (1.8–4.0); default 2.0.
 *
 *  Returns distance in metres. Always positive. RSSI = rssi_at_1m → 1 m
 *  exactly. Each 6 dB drop below rssi_at_1m doubles the distance (a
 *  property of the formula at exponent = 2.0). */
export function pathLossDistance(
  rssi: number,
  rssi1m: number,
  exponent: number = DEFAULT_PATH_LOSS_EXPONENT,
): number {
  return 10 ** ((rssi1m - rssi) / (10 * exponent));
}

/** Vector wrapper. Joins live BLE observations (`{ mac, rssi }`) against
 *  the patient's beacons table; produces a `BeaconDistance[]` for the
 *  trilateration stage.
 *
 *  Filtering rules:
 *  - Beacons not present in the observation are skipped silently — not
 *    every beacon is heard every tick.
 *  - Beacons with null `x_canvas` / `y_canvas` are dropped (placement
 *    not done; they have no canvas position to anchor to).
 *  - Beacons with null `rssi_at_1m` get DEFAULT_RSSI_AT_1M substituted
 *    and a console.warn is emitted once per call (deduplicated by
 *    beacon id) so log volume scales with distinct beacons, not ticks.
 */
export function rssiVectorToDistances(
  observation: BleSample[],
  beacons: BeaconRow[],
  exponent: number = DEFAULT_PATH_LOSS_EXPONENT,
): BeaconDistance[] {
  const rssiByMac = new Map<string, number>();
  for (const sample of observation) {
    if (Number.isFinite(sample.rssi)) rssiByMac.set(sample.mac, sample.rssi);
  }
  const out: BeaconDistance[] = [];
  const warnedDefaults = new Set<string>();
  for (const beacon of beacons) {
    if (beacon.x_canvas == null || beacon.y_canvas == null) continue;
    const rssi = rssiByMac.get(beacon.mac_address);
    if (rssi === undefined) continue;
    let rssi1m = beacon.rssi_at_1m;
    if (rssi1m == null) {
      rssi1m = DEFAULT_RSSI_AT_1M;
      if (!warnedDefaults.has(beacon.id)) {
        warnedDefaults.add(beacon.id);
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'positioning: rssi_at_1m null; using DEFAULT_RSSI_AT_1M',
            beacon_id: beacon.id,
            mac_address: beacon.mac_address,
            default_rssi_at_1m: DEFAULT_RSSI_AT_1M,
          }),
        );
      }
    }
    out.push({
      beacon_id: beacon.id,
      x_canvas: beacon.x_canvas,
      y_canvas: beacon.y_canvas,
      rssi,
      distance_m: pathLossDistance(rssi, rssi1m, exponent),
    });
  }
  return out;
}
