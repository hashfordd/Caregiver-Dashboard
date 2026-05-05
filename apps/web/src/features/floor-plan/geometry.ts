import * as fabric from 'fabric';

export const SNAP_PX = 12;

export interface WorldPoint {
  x: number;
  y: number;
}

/** Collect every endpoint/vertex on the canvas in world coordinates. Used
 *  for snap-to-existing during draw and during endpoint dragging. */
export function collectEndpoints(canvas: fabric.Canvas, exclude?: fabric.Object): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (const obj of canvas.getObjects()) {
    if (obj === exclude) continue;
    if (obj instanceof fabric.Line) {
      const ends = lineWorldEndpoints(obj);
      out.push(ends.start, ends.end);
    } else if (obj instanceof fabric.Polygon) {
      for (const v of polygonWorldVertices(obj)) out.push(v);
    }
  }
  return out;
}

export function snapToEndpoint(
  point: WorldPoint,
  endpoints: WorldPoint[],
  threshold = SNAP_PX,
): { x: number; y: number; snapped: boolean } {
  let bestDist = threshold;
  let best: WorldPoint | null = null;
  for (const ep of endpoints) {
    const d = Math.hypot(ep.x - point.x, ep.y - point.y);
    if (d < bestDist) {
      best = ep;
      bestDist = d;
    }
  }
  return best ? { x: best.x, y: best.y, snapped: true } : { ...point, snapped: false };
}

/** Read a line's endpoints in world coordinates. After a Fabric drag the
 *  internal x1/y1/x2/y2 are stale relative to the new position; the
 *  transform matrix has the truth. */
export function lineWorldEndpoints(line: fabric.Line): { start: WorldPoint; end: WorldPoint } {
  const local = line.calcLinePoints();
  const matrix = line.calcTransformMatrix();
  const start = fabric.util.transformPoint(new fabric.Point(local.x1, local.y1), matrix);
  const end = fabric.util.transformPoint(new fabric.Point(local.x2, local.y2), matrix);
  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
  };
}

/** After Fabric translates / scales a line, push the new world-space
 *  endpoints back into x1/y1/x2/y2 and reset the object's transform so the
 *  stored coords always represent absolute canvas positions. */
export function canonicaliseLine(line: fabric.Line): void {
  const { start, end } = lineWorldEndpoints(line);
  line.set({
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  });
  (line as unknown as { pathOffset: fabric.Point }).pathOffset = new fabric.Point(
    (start.x + end.x) / 2,
    (start.y + end.y) / 2,
  );
  // width/height are read-only on the public surface but settable on the
  // underlying instance — Fabric uses them for hit-testing.
  (line as unknown as { width: number; height: number }).width = Math.abs(end.x - start.x);
  (line as unknown as { width: number; height: number }).height = Math.abs(end.y - start.y);
  line.setCoords();
}

/** Polygon vertices in world coordinates. */
export function polygonWorldVertices(polygon: fabric.Polygon): WorldPoint[] {
  const points = polygon.points ?? [];
  const offset = polygon.pathOffset ?? new fabric.Point(0, 0);
  const matrix = polygon.calcTransformMatrix();
  return points.map((p) => {
    const local = new fabric.Point(p.x - offset.x, p.y - offset.y);
    const world = fabric.util.transformPoint(local, matrix);
    return { x: world.x, y: world.y };
  });
}

/** Replace a polygon's vertices with the given world-space points. Resets
 *  any fabric transform so subsequent edits stay in absolute coords. */
export function setPolygonVertices(polygon: fabric.Polygon, vertices: WorldPoint[]): void {
  if (vertices.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const newPoints = vertices.map((v) => new fabric.Point(v.x - minX, v.y - minY));
  polygon.set({
    points: newPoints,
    left: minX,
    top: minY,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  });
  polygon.pathOffset = new fabric.Point(w / 2, h / 2);
  (polygon as unknown as { width: number; height: number }).width = w;
  (polygon as unknown as { width: number; height: number }).height = h;
  polygon.setCoords();
}

/** Convert a fabric.Rect (room) into a four-vertex polygon at the same
 *  world position. Used so the user can drag corners after creating a
 *  rectangular room. */
export function rectToPolygonVertices(rect: fabric.Rect): WorldPoint[] {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const w = rect.width ?? 0;
  const h = rect.height ?? 0;
  return [
    { x: left, y: top },
    { x: left + w, y: top },
    { x: left + w, y: top + h },
    { x: left, y: top + h },
  ];
}
