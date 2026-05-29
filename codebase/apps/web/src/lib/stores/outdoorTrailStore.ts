import { create } from 'zustand';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

/** Per-patient breadcrumb of outdoor (mode='outdoor') position estimates
 *  for the F9 map view. Per CROSS_CUTTING §7, live realtime data goes
 *  through Zustand, not React Query — the breadcrumb's seed comes from a
 *  React Query fetch on mount, after which the realtime stream is the
 *  source of truth.
 *
 *  Capped to the last 30 minutes per patient. Older points fall off when
 *  a new estimate lands; the trim runs on every push so the trail can't
 *  grow unbounded across a long session. */

const TRAIL_WINDOW_MS = 30 * 60 * 1000;

// Item 152: refcount the store, mirroring positionMarkerStore. Future
// second consumers (e.g. a sidebar "outdoor minutes today" widget) can
// then mount alongside OutdoorMapView without losing the trail when one
// unmounts first. Reset only fires on the last release.
interface OutdoorTrailState {
  byPatient: Record<string, PositionEstimateRow[]>;
  refcountByPatient: Record<string, number>;
  /** Replace the trail with a fresh fetch (initial mount, route change). */
  hydrate: (patientId: string, rows: PositionEstimateRow[]) => void;
  /** Append a new realtime estimate; trim to the 30-min window. */
  push: (patientId: string, row: PositionEstimateRow) => void;
  /** Increment a patient's subscriber count. */
  acquire: (patientId: string) => void;
  /** Decrement; clear the trail when refcount hits zero. */
  release: (patientId: string) => void;
  /** Force-clear regardless of refcount. Tests + explicit logout. */
  reset: (patientId: string) => void;
}

export const useOutdoorTrailStore = create<OutdoorTrailState>((set) => ({
  byPatient: {},
  refcountByPatient: {},
  hydrate: (patientId, rows) =>
    set((state) => ({
      byPatient: {
        ...state.byPatient,
        [patientId]: trimTo30Min(sortAscending(rows)),
      },
    })),
  push: (patientId, row) =>
    set((state) => {
      const prev = state.byPatient[patientId] ?? [];
      const next = trimTo30Min([...prev, row]);
      return { byPatient: { ...state.byPatient, [patientId]: next } };
    }),
  acquire: (patientId) =>
    set((state) => ({
      refcountByPatient: {
        ...state.refcountByPatient,
        [patientId]: (state.refcountByPatient[patientId] ?? 0) + 1,
      },
    })),
  release: (patientId) =>
    set((state) => {
      const next = (state.refcountByPatient[patientId] ?? 0) - 1;
      const nextRefcount = { ...state.refcountByPatient };
      const nextByPatient = { ...state.byPatient };
      if (next <= 0) {
        delete nextRefcount[patientId];
        delete nextByPatient[patientId];
      } else {
        nextRefcount[patientId] = next;
      }
      return { refcountByPatient: nextRefcount, byPatient: nextByPatient };
    }),
  reset: (patientId) =>
    set((state) => {
      const next = { ...state.byPatient };
      delete next[patientId];
      return { byPatient: next };
    }),
}));

function sortAscending(rows: PositionEstimateRow[]): PositionEstimateRow[] {
  return [...rows].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

// `rows` is always time-ascending (hydrate sorts; push appends newer
// samples), so expired points are a contiguous prefix. Drop them with a
// front scan + single slice instead of a full filter that re-parses every
// timestamp on every 1 Hz push — typically 0–1 points expire per call, so
// the common path is O(1) and returns the input array untouched.
function trimTo30Min(rows: PositionEstimateRow[]): PositionEstimateRow[] {
  const tail = rows[rows.length - 1];
  if (!tail) return rows;
  const cutoffMs = new Date(tail.recorded_at).getTime() - TRAIL_WINDOW_MS;
  let start = 0;
  while (start < rows.length) {
    const r = rows[start]!;
    if (new Date(r.recorded_at).getTime() >= cutoffMs) break;
    start += 1;
  }
  return start === 0 ? rows : rows.slice(start);
}
