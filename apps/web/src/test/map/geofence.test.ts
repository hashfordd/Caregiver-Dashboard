import { describe, expect, it } from 'vitest';
import {
  GeofenceParams,
  GeofencePolygon,
  isClosedPolygon,
  isSimplePolygon,
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

describe('GeofenceParams Zod schema', () => {
  it('parses a valid params payload', () => {
    const parsed = GeofenceParams.safeParse({
      geofence: SQUARE,
      mode: 'exit',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown mode values', () => {
    const parsed = GeofenceParams.safeParse({
      geofence: SQUARE,
      mode: 'sideways',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects polygons with too few vertices', () => {
    const parsed = GeofenceParams.safeParse({
      geofence: {
        type: 'polygon',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      mode: 'enter',
    });
    expect(parsed.success).toBe(false);
  });

  it('round-trips coordinates without loss', () => {
    const params = { geofence: SQUARE, mode: 'enter' as const };
    const parsed = GeofenceParams.parse(params);
    expect(parsed.geofence.coordinates).toEqual(SQUARE.coordinates);
  });
});
