import { describe, it, expect } from 'vitest';
import { parseBeaconArg, ParseBeaconArgError } from '../lib/parse-beacon-arg';

const DEFAULT_RSSI = -59;

describe('parseBeaconArg', () => {
  it('parses the canonical MAC|x,y form with the default rssi_at_1m', () => {
    const out = parseBeaconArg('AA:BB:CC:DD:EE:01|60,120', DEFAULT_RSSI);
    expect(out).toEqual({
      id: 'AA:BB:CC:DD:EE:01',
      x: 60,
      y: 120,
      rssi_at_1m: DEFAULT_RSSI,
    });
  });

  it('parses an explicit rssi_at_1m third component', () => {
    const out = parseBeaconArg('AA:BB:CC:DD:EE:02|180,240,-65', DEFAULT_RSSI);
    expect(out.rssi_at_1m).toBe(-65);
  });

  it('rejects a missing rest after the pipe', () => {
    expect(() => parseBeaconArg('AA:BB:CC:DD:EE:03|', DEFAULT_RSSI)).toThrow(ParseBeaconArgError);
  });

  it('rejects a missing y component', () => {
    expect(() => parseBeaconArg('AA:BB:CC:DD:EE:04|60', DEFAULT_RSSI)).toThrow(
      ParseBeaconArgError,
    );
  });

  it('rejects non-numeric x', () => {
    expect(() => parseBeaconArg('AA:BB:CC:DD:EE:05|abc,120', DEFAULT_RSSI)).toThrow(
      /finite numbers/,
    );
  });

  it('rejects non-numeric rssi when supplied', () => {
    expect(() => parseBeaconArg('AA:BB:CC:DD:EE:06|60,120,nope', DEFAULT_RSSI)).toThrow(
      /finite number/,
    );
  });

  it('treats an empty rssi field as "use the default"', () => {
    const out = parseBeaconArg('AA:BB:CC:DD:EE:07|60,120,', DEFAULT_RSSI);
    expect(out.rssi_at_1m).toBe(DEFAULT_RSSI);
  });

  it('rejects an entirely empty arg', () => {
    expect(() => parseBeaconArg('', DEFAULT_RSSI)).toThrow(ParseBeaconArgError);
  });
});
