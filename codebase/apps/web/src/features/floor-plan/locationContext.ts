// Floor-plan intelligence: turn a live indoor position into a human-readable
// "what is the patient doing / where" context — e.g. "In bed", "At the sink",
// "At the window", "Near the door — may be leaving the room", or just the room
// name. Derives everything from the same geometry the caregiver placed:
//   - rooms        → polygon containment (which room)
//   - furniture    → parsed out of the Fabric canvas_json (label + footprint)
//   - connectors   → door / window / opening segments (proximity)
// Pure functions; no React, no DB.

import { FURNITURE_KINDS, furnitureLabel } from './furniture';
import type { RoomRow, RoomConnectorRow } from './roomTypes';

export interface Pt {
  x: number;
  y: number;
}

/** A furniture footprint recovered from canvas_json, in world (canvas-pixel)
 *  coordinates. `label` is the caregiver-facing name ("Double bed", "Sink"…). */
export interface FurnitureItem {
  label: string;
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

export type ContextTone = 'normal' | 'warn';

export interface LocationContext {
  /** Primary phrase, e.g. "In bed" or "Near the door — may be leaving the room". */
  text: string;
  /** Secondary detail (usually the room name), or null. */
  detail: string | null;
  /** `warn` for door/window proximity so the UI can flag it like a soft alert. */
  tone: ContextTone;
}

const FURN_LABELS = new Set(FURNITURE_KINDS.map((k) => furnitureLabel(k).toLowerCase()));

/** Map a furniture label to a natural "patient is …" phrase. */
function furniturePhrase(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('bed')) return 'In bed';
  if (l.includes('sofa')) return 'On the sofa';
  if (l.includes('chair')) return 'Sitting in the chair';
  if (l.includes('table')) return 'Sitting at the table';
  if (l.includes('desk')) return 'At the desk';
  if (l.includes('wardrobe')) return 'At the wardrobe';
  if (l.includes('tv')) return 'By the TV';
  if (l.includes('toilet')) return 'At the toilet';
  if (l.includes('sink')) return 'At the sink';
  if (l.includes('bath')) return 'At the bath';
  if (l.includes('shower')) return 'In the shower';
  return `At the ${label.toLowerCase()}`;
}

/** Recover furniture footprints from a Fabric `canvas_json` blob. Furniture is
 *  stored as a Fabric group tagged `__fpKind:'furniture'` whose IText child
 *  carries the label; we accept either the tag or a known-label text child so
 *  it's robust to whether the custom prop survived serialization. */
export function extractFurniture(canvasJson: unknown): FurnitureItem[] {
  const root = canvasJson as { objects?: unknown[] } | null | undefined;
  const objs = Array.isArray(root?.objects) ? root!.objects! : [];
  const out: FurnitureItem[] = [];
  for (const raw of objs) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (String(o.type ?? '').toLowerCase() !== 'group') continue;
    const children = Array.isArray(o.objects) ? (o.objects as Record<string, unknown>[]) : [];
    const tagged = o.__fpKind === 'furniture';
    let label: string | null = null;
    for (const ch of children) {
      const t = String(ch?.text ?? '').trim();
      if (t && (FURN_LABELS.has(t.toLowerCase()) || tagged)) {
        label = t;
        break;
      }
    }
    if (!label) continue;
    const scaleX = Number(o.scaleX ?? 1) || 1;
    const scaleY = Number(o.scaleY ?? 1) || 1;
    const w = Number(o.width ?? 0) * scaleX;
    const h = Number(o.height ?? 0) * scaleY;
    const left = Number(o.left ?? 0);
    const top = Number(o.top ?? 0);
    // Furniture groups are created originX/originY 'center', so left/top are the
    // centre; fall back to top-left interpretation when origin says otherwise.
    const cx = o.originX === 'center' ? left : left + w / 2;
    const cy = o.originY === 'center' ? top : top + h / 2;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    out.push({ label, cx, cy, halfW: Math.abs(w) / 2, halfH: Math.abs(h) / 2 });
  }
  return out;
}

/** Ray-casting point-in-polygon. Polygon is [[x,y], …] with implicit closure. */
export function pointInPolygon(p: Pt, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Shortest distance from point p to segment a–b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Resolve the patient's position into a location context. Priority:
 *   1. Furniture footprint hit (most specific — "In bed", "At the sink")
 *   2. Door / window / opening proximity (a soft "leaving the room" / "at the
 *      window" warning)
 *   3. Containing room name ("In the Master Bedroom")
 *   4. Unknown
 */
export function computeLocationContext(
  pos: Pt,
  rooms: RoomRow[],
  connectors: RoomConnectorRow[],
  furniture: FurnitureItem[],
  scaleMetersPerPixel: number | null,
): LocationContext {
  const mPerPx = scaleMetersPerPixel && scaleMetersPerPixel > 0 ? scaleMetersPerPixel : null;
  const room = rooms.find((r) => pointInPolygon(pos, r.polygon_canvas)) ?? null;
  const roomName = room?.name ?? null;

  // 1. Furniture — nearest piece whose footprint (+ a small grace margin)
  // contains the point.
  const marginPx = mPerPx ? 0.3 / mPerPx : 18; // ~30 cm reach
  let bestFurn: FurnitureItem | null = null;
  let bestCentreD = Infinity;
  for (const f of furniture) {
    const dx = Math.max(Math.abs(pos.x - f.cx) - f.halfW - marginPx, 0);
    const dy = Math.max(Math.abs(pos.y - f.cy) - f.halfH - marginPx, 0);
    if (dx === 0 && dy === 0) {
      const cd = Math.hypot(pos.x - f.cx, pos.y - f.cy);
      if (cd < bestCentreD) {
        bestCentreD = cd;
        bestFurn = f;
      }
    }
  }
  if (bestFurn) return { text: furniturePhrase(bestFurn.label), detail: roomName, tone: 'normal' };

  // 2. Door / window / opening proximity.
  const nearPx = mPerPx ? 0.8 / mPerPx : 45; // within ~80 cm of the segment
  let nearest: RoomConnectorRow | null = null;
  let nearestD = Infinity;
  for (const c of connectors) {
    const d = distToSegment(pos, { x: c.start_x, y: c.start_y }, { x: c.end_x, y: c.end_y });
    if (d < nearestD) {
      nearestD = d;
      nearest = c;
    }
  }
  if (nearest && nearestD <= nearPx) {
    if (nearest.kind === 'door')
      return { text: 'Near the door — may be leaving the room', detail: roomName, tone: 'warn' };
    if (nearest.kind === 'window') return { text: 'At the window', detail: roomName, tone: 'warn' };
    return { text: 'At a doorway', detail: roomName, tone: 'warn' };
  }

  // 3. Room only.
  if (roomName) return { text: `In the ${roomName}`, detail: null, tone: 'normal' };

  // 4. Unknown.
  return { text: 'Somewhere in the space', detail: null, tone: 'normal' };
}
