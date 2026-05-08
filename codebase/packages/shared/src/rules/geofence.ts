// F9 → F11 contract. GeoJSON outdoor polygon shape used by the
// outdoor-zone branch of `ZoneParams` (see ./types.ts). The
// surrounding indoor/outdoor unification was completed in Phase C; this
// module now owns just the geometry shape + structural validators —
// the rule-shape contract lives in `./types.ts` next to the indoor
// counterpart.
//
// **Coordinate convention**: GeoJSON [lng, lat] — opposite of how
// humans say it. Mapbox expects this order; the evaluator must read
// it the same way. Don't drift.

import { z } from 'zod';

export const GeofencePolygon = z.object({
  type: z.literal('polygon'),
  /** Closed polygon: first and last points must be equal. Coordinates
   *  are [lng, lat] pairs (GeoJSON convention). */
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(4, {
    message: 'Polygon needs ≥ 3 distinct vertices (4 points including the closing duplicate)',
  }),
});
export type GeofencePolygon = z.infer<typeof GeofencePolygon>;

/** True if `polygon` has at least 3 distinct vertices and is properly
 *  closed (first === last). Cheap structural check used at write time;
 *  geometric validity (no self-intersection) is checked separately. */
export function isClosedPolygon(polygon: GeofencePolygon): boolean {
  const c = polygon.coordinates;
  if (c.length < 4) return false;
  const first = c[0];
  const last = c[c.length - 1];
  if (!first || !last) return false;
  return first[0] === last[0] && first[1] === last[1];
}

/** O(n²) self-intersection check on a closed polygon. Returns true if
 *  any non-adjacent edge pair crosses. Fine for prototype scope (a
 *  hand-drawn geofence is tens of vertices, not thousands). */
export function isSimplePolygon(polygon: GeofencePolygon): boolean {
  const pts = polygon.coordinates;
  const n = pts.length - 1; // last point is the closing duplicate
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (!a || !b) continue;
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (they share a vertex).
      if (j === i || (j + 1) % n === i) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (!c || !d) continue;
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1 = cross(p4, p3, p1);
  const d2 = cross(p4, p3, p2);
  const d3 = cross(p2, p1, p3);
  const d4 = cross(p2, p1, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
