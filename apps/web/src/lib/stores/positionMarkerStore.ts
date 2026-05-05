import { create } from 'zustand';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

/** Live patient marker store. Per CROSS_CUTTING §7, live realtime data
 *  goes through Zustand (not React Query), so the marker stays in sync
 *  with the at-most-1-Hz position estimate stream without invalidating
 *  any cache. Keyed by patient_id so a multi-patient session — e.g. a
 *  caregiver flipping between dashboards — doesn't bleed one patient's
 *  position into another. */
interface PositionMarkerState {
  latestByPatient: Record<string, PositionEstimateRow>;
  pushEstimate: (patientId: string, row: PositionEstimateRow) => void;
  /** Wipe all data for a patient. Called on patient route change /
   *  unmount so a stale marker from a previous patient doesn't flash
   *  on the new patient's canvas. */
  reset: (patientId: string) => void;
}

export const usePositionMarkerStore = create<PositionMarkerState>((set) => ({
  latestByPatient: {},
  pushEstimate: (patientId, row) =>
    set((state) => ({
      latestByPatient: { ...state.latestByPatient, [patientId]: row },
    })),
  reset: (patientId) =>
    set((state) => {
      const next = { ...state.latestByPatient };
      delete next[patientId];
      return { latestByPatient: next };
    }),
}));
