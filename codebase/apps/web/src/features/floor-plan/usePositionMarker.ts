import { useEffect } from 'react';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import { usePositionMarkerStore } from '@/lib/stores/positionMarkerStore';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

/** Subscribes to onPositionEstimate and fans rows into the marker store.
 *  Returns the latest estimate for the current patient (or undefined
 *  when none has arrived yet).
 *
 *  Refcounted: multiple components on the same patient page can call
 *  this hook safely (e.g. the F9 mode-router + the indoor LivePositionView).
 *  The store's last entry is only cleared when the last subscriber for
 *  this patient unmounts. */
export function usePositionMarker(): PositionEstimateRow | undefined {
  const { patientId, onPositionEstimate } = usePatientStreamContext();
  const latest = usePositionMarkerStore((s) => s.latestByPatient[patientId]);

  useEffect(() => {
    usePositionMarkerStore.getState().acquire(patientId);
    const unsubscribe = onPositionEstimate((row) => {
      usePositionMarkerStore.getState().pushEstimate(patientId, row);
    });
    return () => {
      unsubscribe();
      usePositionMarkerStore.getState().release(patientId);
    };
  }, [patientId, onPositionEstimate]);

  return latest;
}
