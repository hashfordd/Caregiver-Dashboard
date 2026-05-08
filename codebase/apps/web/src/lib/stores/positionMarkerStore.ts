import { create } from 'zustand';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

/** Live patient marker store. Per CROSS_CUTTING §7, live realtime data
 *  goes through Zustand (not React Query). Keyed by patient_id so a
 *  multi-patient session doesn't bleed one patient's position into
 *  another.
 *
 *  Refcount: F9's mode-router and the indoor view both subscribe via
 *  `usePositionMarker`. A naive "reset on unmount" wipes the store
 *  when one consumer unmounts even though the other still wants the
 *  marker. The refcount lets the cleanup only fire when the *last*
 *  subscriber for a patient unmounts. */
interface PositionMarkerState {
  latestByPatient: Record<string, PositionEstimateRow>;
  refcountByPatient: Record<string, number>;
  pushEstimate: (patientId: string, row: PositionEstimateRow) => void;
  /** Increment a patient's subscriber count; returns the new count. */
  acquire: (patientId: string) => void;
  /** Decrement; if it reaches zero, drop the latest entry too. */
  release: (patientId: string) => void;
}

export const usePositionMarkerStore = create<PositionMarkerState>((set) => ({
  latestByPatient: {},
  refcountByPatient: {},
  pushEstimate: (patientId, row) =>
    set((state) => ({
      latestByPatient: { ...state.latestByPatient, [patientId]: row },
    })),
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
      const nextLatest = { ...state.latestByPatient };
      if (next <= 0) {
        delete nextRefcount[patientId];
        delete nextLatest[patientId];
      } else {
        nextRefcount[patientId] = next;
      }
      return { refcountByPatient: nextRefcount, latestByPatient: nextLatest };
    }),
}));
