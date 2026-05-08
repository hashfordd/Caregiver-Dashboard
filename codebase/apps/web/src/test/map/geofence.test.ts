import { describe, expect, it } from 'vitest';
import {
  GeofencePolygon,
  isClosedPolygon,
  isSimplePolygon,
  OutdoorZoneParams,
} from '@alzcare/shared/rules';

const SQUARE: GeofencePolygon = {
  type: 'polygon',
  coordinates: [
    [144.96, -37.81],
    [144.97, -37.81],
    [144.97, -37.82],
    [144.96, -37.82],
    [144.96, -37.81],
  ],
};

const BOWTIE: GeofencePolygon = {
  type: 'polygon',
  coordinates: [
    [144.96, -37.81],
    [144.97, -37.82],
    [144.97, -37.81],
    [144.96, -37.82],
    [144.96, -37.81],
  ],
};

describe('GeofencePolygon contract', () => {
  it('isClosedPolygon accepts a properly closed square', () => {
    expect(isClosedPolygon(SQUARE)).toBe(true);
  });

  it('isClosedPolygon rejects an unclosed polygon', () => {
    const open: GeofencePolygon = {
      type: 'polygon',
      coordinates: SQUARE.coordinates.slice(0, -1),
    };
    expect(isClosedPolygon(open)).toBe(false);
  });

  it('isClosedPolygon rejects fewer than 3 distinct vertices', () => {
    const tiny: GeofencePolygon = {
      type: 'polygon',
      coordinates: [
        [0, 0],
        [1, 1],
        [0, 0],
      ],
    };
    expect(isClosedPolygon(tiny)).toBe(false);
  });

  it('isSimplePolygon accepts a convex square', () => {
    expect(isSimplePolygon(SQUARE)).toBe(true);
  });

  it('isSimplePolygon rejects a self-intersecting bowtie', () => {
    expect(isSimplePolygon(BOWTIE)).toBe(false);
  });
});

describe('OutdoorZoneParams Zod schema', () => {
  it('parses a valid outdoor params payload', () => {
    const parsed = OutdoorZoneParams.safeParse({
      space: 'outdoor',
      geofence: SQUARE,
      direction: 'exit',
      dwell_seconds: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown direction values', () => {
    const parsed = OutdoorZoneParams.safeParse({
      space: 'outdoor',
      geofence: SQUARE,
      direction: 'sideways',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects polygons with too few vertices', () => {
    const parsed = OutdoorZoneParams.safeParse({
      space: 'outdoor',
      geofence: {
        type: 'polygon',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      direction: 'enter',
    });
    expect(parsed.success).toBe(false);
  });

  it('round-trips coordinates without loss', () => {
    const parsed = OutdoorZoneParams.parse({
      space: 'outdoor',
      geofence: SQUARE,
      direction: 'enter',
    });
    expect(parsed.geofence.coordinates).toEqual(SQUARE.coordinates);
  });

  it('defaults dwell_seconds to 0 when omitted', () => {
    const parsed = OutdoorZoneParams.parse({
      space: 'outdoor',
      geofence: SQUARE,
      direction: 'enter',
    });
    expect(parsed.dwell_seconds).toBe(0);
  });
});
