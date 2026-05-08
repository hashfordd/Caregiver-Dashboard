// Item 110: extracted from index.ts so it can be unit-tested without
// running the harness's main() side effects. parseBeaconArg is the
// only configuration path for the F8 verification gate; a regression
// in the parser silently breaks the gate without surfacing a test
// failure, which is the load-bearing risk the audit flagged.

export interface BeaconArg {
  id: string;
  x: number;
  y: number;
  rssi_at_1m: number;
}

export class ParseBeaconArgError extends Error {
  constructor(input: string, reason: string) {
    super(`invalid --beacon arg: ${input} (${reason})`);
    this.name = 'ParseBeaconArgError';
  }
}

/**
 * Parses a `--beacon` CLI value of the form
 *   `<mac>|<x>,<y>[,<rssi1m>]`
 * into a structured BeaconArg. The `|` separator (rather than `:`) is
 * required because BLE MAC addresses already contain colons.
 */
export function parseBeaconArg(arg: string, defaultRssiAt1m: number): BeaconArg {
  const [id, rest] = arg.split('|');
  if (!id || !rest) {
    throw new ParseBeaconArgError(arg, "expected '<mac>|<x>,<y>[,<rssi1m>]'");
  }
  const [xs, ys, rssi1m] = rest.split(',');
  if (!xs || !ys) {
    throw new ParseBeaconArgError(arg, "expected '<mac>|<x>,<y>[,<rssi1m>]'");
  }
  const x = Number(xs);
  const y = Number(ys);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new ParseBeaconArgError(arg, 'x and y must be finite numbers');
  }
  const rssi = rssi1m != null && rssi1m !== '' ? Number(rssi1m) : defaultRssiAt1m;
  if (!Number.isFinite(rssi)) {
    throw new ParseBeaconArgError(arg, 'rssi_at_1m must be a finite number');
  }
  return { id, x, y, rssi_at_1m: rssi };
}
