// Phase B types for the rooms + room_connectors tables.
//
// Separate file (rather than appending to `types.ts`) so the floor-plan
// editor's existing types stay focused on canvas / Fabric concerns, and
// downstream consumers (rules engine, alert UI) can depend only on the
// addressable shapes without pulling in canvas internals.

export const ROOM_TYPES = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living_room',
  'dining_room',
  'hallway',
  'other',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const CONNECTOR_KINDS = ['door', 'window', 'opening'] as const;
export type ConnectorKind = (typeof CONNECTOR_KINDS)[number];

/** Caregiver-readable label per room_type. Kept here so the panel UI and
 *  any future alert preview render the same wording. */
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  kitchen: 'Kitchen',
  living_room: 'Living room',
  dining_room: 'Dining room',
  hallway: 'Hallway',
  other: 'Other',
};

export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  door: 'Door',
  window: 'Window',
  opening: 'Opening',
};

export interface RoomRow {
  id: string;
  patient_id: string;
  floor_plan_id: string;
  name: string;
  room_type: RoomType;
  /** Polygon vertices in canvas-pixel coordinates, [[x, y], …]. Implicit
   *  closure — no need to repeat the first vertex. DB enforces ≥ 3 entries. */
  polygon_canvas: [number, number][];
  created_at: string;
  updated_at: string;
}

export interface UpsertRoomInput {
  id?: string;
  patient_id: string;
  floor_plan_id: string;
  name: string;
  room_type: RoomType;
  polygon_canvas: [number, number][];
}

export interface RoomConnectorRow {
  id: string;
  patient_id: string;
  floor_plan_id: string;
  kind: ConnectorKind;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  room_a_id: string | null;
  room_b_id: string | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertRoomConnectorInput {
  id?: string;
  patient_id: string;
  floor_plan_id: string;
  kind: ConnectorKind;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  room_a_id?: string | null;
  room_b_id?: string | null;
  label?: string | null;
}

/**
 * Parse a textarea body (one vertex per line, "x,y" or "x y") into a
 * polygon. Tolerant of whitespace, comments, blank lines. Surfaces a
 * single human-readable error on the first invalid line — assumes the
 * caller wants to highlight that line, not aggregate every issue.
 *
 * Why parsing happens client-side: the textarea is the prototype's
 * polygon-entry path until canvas-side picking lands. The DB only
 * enforces vertex count and JSON shape; the syntactic validation lives
 * here so the dialog can show errors immediately rather than on submit.
 */
export interface ParsePolygonOk {
  ok: true;
  polygon: [number, number][];
}
export interface ParsePolygonErr {
  ok: false;
  error: string;
  /** 1-based line number the parser failed on, when applicable. */
  line?: number;
}
export function parsePolygonText(text: string): ParsePolygonOk | ParsePolygonErr {
  const polygon: [number, number][] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!.split('#')[0]!.trim();
    if (line === '') continue;
    const parts = line.split(/[\s,]+/).filter((p) => p !== '');
    if (parts.length !== 2) {
      return {
        ok: false,
        error: 'each line must be "x, y" (got ' + parts.length + ' values)',
        line: i + 1,
      };
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'x and y must be numbers', line: i + 1 };
    }
    polygon.push([x, y]);
  }
  if (polygon.length < 3) {
    return {
      ok: false,
      error: 'need at least 3 vertices to form a polygon (got ' + polygon.length + ')',
    };
  }
  return { ok: true, polygon };
}

/** Inverse: render a stored polygon back as "x, y" lines. Used by the
 *  edit dialog to seed the textarea from an existing row. */
export function polygonToText(polygon: [number, number][]): string {
  return polygon.map(([x, y]) => `${x}, ${y}`).join('\n');
}
