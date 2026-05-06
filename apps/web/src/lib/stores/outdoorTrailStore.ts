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

interface OutdoorTrailState {
  byPatient: Record<string, PositionEstimateRow[]>;
  /** Replace the trail with a fresh fetch (initial mount, route change). */
  hydrate: (patientId: string, rows: PositionEstimateRow[]) => void;
  /** Append a new realtime estimate; trim to the 30-min window. */
  push: (patientId: string, row: PositionEstimateRow) => void;
  reset: (patientId: string) => void;
}

export const useOutdoorTrailStore = create<OutdoorTrailState>((set) => ({
  byPatient: {},
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

function trimTo30Min(rows: PositionEstimateRow[]): PositionEstimateRow[] {
  const tail = rows[rows.length - 1];
  if (!tail) return rows;
  const newestMs = new Date(tail.recorded_at).getTime();
  const cutoffMs = newestMs - TRAIL_WINDOW_MS;
  return rows.filter((r) => new Date(r.recorded_at).getTime() >= cutoffMs);
}
