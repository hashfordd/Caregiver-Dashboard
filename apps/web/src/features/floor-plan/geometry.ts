import * as fabric from 'fabric';

export const SNAP_PX = 12;
/** Two endpoints are treated as the same join when they're within this
 *  many world pixels of each other. Endpoints land exactly on the grid
 *  after snap, but tiny float drift can sneak in across canonicalise
 *  cycles. */
export const JOIN_EPSILON = 0.5;
/** When the caregiver clicks a join to break it, members are nudged
 *  apart by this many pixels along radial directions so subsequent drags
 *  no longer treat them as partners. */
export const JOIN_DISCONNECT_NUDGE = 4;

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
 *  stored coords always represent absolute canvas positions.
 *
 *  IMPORTANT: in Fabric 7 the default origin is `center`, so `left` / `top`
 *  represent the object's centre, not its top-left. Don't set them
 *  manually — Line.set() on x1/y1/x2/y2 invokes _setWidthHeight, which
 *  recomputes width/height and re-positions the line so its centre lands
 *  at the new geometric centre of the endpoints. Setting left/top by
 *  hand to `Math.min(...)` was making walls jump (their centre snapped
 *  to the bbox top-left). */
export function canonicaliseLine(line: fabric.Line): void {
  const { start, end } = lineWorldEndpoints(line);
  line.set({
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  });
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
 *  any fabric transform; calls Polyline.setBoundingBox(true) so the
 *  polygon's pathOffset / width / height / position are recomputed
 *  correctly for the new vertex set (analogue of Line._setWidthHeight). */
export function setPolygonVertices(polygon: fabric.Polygon, vertices: WorldPoint[]): void {
  if (vertices.length === 0) return;
  polygon.set({
    points: vertices.map((v) => new fabric.Point(v.x, v.y)),
    scaleX: 1,
    scaleY: 1,
    angle: 0,
  });
  // setBoundingBox(true) is the public API on Polyline that recomputes
  // pathOffset and re-positions the polygon's centre to the new vertex
  // bbox centre. The TS types omit it, so cast.
  (polygon as unknown as { setBoundingBox: (adjust: boolean) => void }).setBoundingBox(true);
  polygon.setCoords();
}

/** A cluster of 2+ wall endpoints sharing a world coordinate. */
export interface WallJoin {
  x: number;
  y: number;
  members: { wall: fabric.Line; endpointIdx: 0 | 1 }[];
}

const joinKey = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;

/** Find every world point where two or more wall endpoints coincide.
 *  O(n) using a hash map keyed on rounded coords. */
export function findJoins(canvas: fabric.Canvas): WallJoin[] {
  const map = new Map<string, WallJoin>();
  for (const obj of canvas.getObjects()) {
    if (!(obj instanceof fabric.Line)) continue;
    const k = (obj as unknown as { __fpKind?: string }).__fpKind;
    if (k !== 'wall') continue;
    const ends = lineWorldEndpoints(obj);
    pushEndpoint(map, ends.start, obj, 0);
    pushEndpoint(map, ends.end, obj, 1);
  }
  return [...map.values()].filter((j) => j.members.length >= 2);
}

function pushEndpoint(
  map: Map<string, WallJoin>,
  point: WorldPoint,
  wall: fabric.Line,
  endpointIdx: 0 | 1,
): void {
  const key = joinKey(point.x, point.y);
  let entry = map.get(key);
  if (!entry) {
    entry = { x: point.x, y: point.y, members: [] };
    map.set(key, entry);
  }
  entry.members.push({ wall, endpointIdx });
}

/** Return the OTHER walls' endpoints that share the given wall's
 *  endpoint coordinate. Uses the same `Math.round(x):Math.round(y)` key
 *  as findJoins, so the partner detection and the visible green-ring
 *  join indicator never disagree about whether two walls are connected.
 *
 *  (The epsilon parameter is kept for API compatibility but is no longer
 *  used — Math.round equality is strictly tighter, which is what we
 *  want.) */
export function findConnectedPartners(
  canvas: fabric.Canvas,
  wall: fabric.Line,
  endpointIdx: 0 | 1,
): { wall: fabric.Line; endpointIdx: 0 | 1 }[] {
  const ends = lineWorldEndpoints(wall);
  const target = endpointIdx === 0 ? ends.start : ends.end;
  const tx = Math.round(target.x);
  const ty = Math.round(target.y);
  const out: { wall: fabric.Line; endpointIdx: 0 | 1 }[] = [];
  for (const obj of canvas.getObjects()) {
    if (obj === wall) continue;
    if (!(obj instanceof fabric.Line)) continue;
    const k = (obj as unknown as { __fpKind?: string }).__fpKind;
    if (k !== 'wall') continue;
    const e = lineWorldEndpoints(obj);
    if (Math.round(e.start.x) === tx && Math.round(e.start.y) === ty) {
      out.push({ wall: obj, endpointIdx: 0 });
    }
    if (Math.round(e.end.x) === tx && Math.round(e.end.y) === ty) {
      out.push({ wall: obj, endpointIdx: 1 });
    }
  }
  return out;
}

/** Walk the wall connectivity graph from `start`, returning every wall
 *  reachable through chains of shared endpoints. Used so dragging any
 *  member of a connected room translates the entire room as a rigid
 *  group rather than just rubber-banding the shared corner. */
export function findConnectedWallGroup(canvas: fabric.Canvas, start: fabric.Line): fabric.Line[] {
  const visited = new Set<fabric.Line>([start]);
  const queue: fabric.Line[] = [start];
  while (queue.length > 0) {
    const w = queue.shift()!;
    for (const idx of [0, 1] as const) {
      for (const p of findConnectedPartners(canvas, w, idx)) {
        if (!visited.has(p.wall)) {
          visited.add(p.wall);
          queue.push(p.wall);
        }
      }
    }
  }
  return [...visited];
}

/** Set a single endpoint of a wall in world coords. Triggers Fabric's
 *  internal _setWidthHeight so width/height/centre stay correct. */
export function setLineEndpoint(line: fabric.Line, endpointIdx: 0 | 1, x: number, y: number): void {
  if (endpointIdx === 0) {
    line.set({ x1: x, y1: y });
  } else {
    line.set({ x2: x, y2: y });
  }
  line.setCoords();
}

/** Find every closed wall loop on the canvas, returned as ordered
 *  polygon vertex lists in world coords. A loop is a connected
 *  component of the wall graph in which every node (join point) has
 *  exactly two walls touching it — i.e. a simple cycle. Used to draw
 *  room-shading visual feedback so the caregiver knows their walls
 *  enclose a sealed area. */
export function findClosedRooms(canvas: fabric.Canvas): WorldPoint[][] {
  const walls: fabric.Line[] = canvas
    .getObjects()
    .filter(
      (o): o is fabric.Line =>
        o instanceof fabric.Line && (o as unknown as { __fpKind?: string }).__fpKind === 'wall',
    );
  if (walls.length < 3) return [];

  const key = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;

  // Build node map: world coord (rounded) → { x, y, walls: [{ wall, endpointIdx }] }.
  type Node = { x: number; y: number; walls: { wall: fabric.Line; endpointIdx: 0 | 1 }[] };
  const nodes = new Map<string, Node>();
  // Cache wall endpoints to avoid recomputing transform matrix in tight loops.
  const wallEnds = new Map<fabric.Line, { start: WorldPoint; end: WorldPoint }>();
  for (const w of walls) {
    const ends = lineWorldEndpoints(w);
    wallEnds.set(w, ends);
    for (const [pt, idx] of [
      [ends.start, 0 as const],
      [ends.end, 1 as const],
    ] as const) {
      const k = key(pt.x, pt.y);
      let n = nodes.get(k);
      if (!n) {
        n = { x: pt.x, y: pt.y, walls: [] };
        nodes.set(k, n);
      }
      n.walls.push({ wall: w, endpointIdx: idx });
    }
  }

  const wallOtherNode = (wall: fabric.Line, here: Node): Node | undefined => {
    const ends = wallEnds.get(wall);
    if (!ends) return undefined;
    const startKey = key(ends.start.x, ends.start.y);
    const hereKey = key(here.x, here.y);
    return nodes.get(startKey === hereKey ? key(ends.end.x, ends.end.y) : startKey);
  };

  const visitedNode = new Set<string>();
  const rooms: WorldPoint[][] = [];

  for (const [startKey, startNode] of nodes) {
    if (visitedNode.has(startKey)) continue;
    if (startNode.walls.length !== 2) {
      visitedNode.add(startKey);
      continue;
    }
    // Walk the loop. Pick a starting wall arbitrarily; advance via the
    // OTHER wall at each node. Stop when we return to startNode.
    const orderedNodes: Node[] = [startNode];
    const orderedNodeKeys: string[] = [startKey];
    let prevWall: fabric.Line | undefined;
    let cur: Node | undefined = startNode;
    let isLoop = false;
    let degenerate = false;
    while (cur && orderedNodes.length <= walls.length) {
      const nextEntry = cur.walls.find((w) => w.wall !== prevWall);
      if (!nextEntry) {
        degenerate = true;
        break;
      }
      const next = wallOtherNode(nextEntry.wall, cur);
      if (!next) {
        degenerate = true;
        break;
      }
      const nextKey = key(next.x, next.y);
      if (nextKey === startKey) {
        isLoop = true;
        break;
      }
      if (next.walls.length !== 2) {
        degenerate = true;
        break;
      }
      if (orderedNodeKeys.includes(nextKey)) {
        // Self-intersecting walk — bail out to avoid infinite loops.
        degenerate = true;
        break;
      }
      orderedNodes.push(next);
      orderedNodeKeys.push(nextKey);
      prevWall = nextEntry.wall;
      cur = next;
    }
    for (const k of orderedNodeKeys) visitedNode.add(k);
    if (isLoop && !degenerate && orderedNodes.length >= 3) {
      rooms.push(orderedNodes.map((n) => ({ x: n.x, y: n.y })));
    }
  }

  return rooms;
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
