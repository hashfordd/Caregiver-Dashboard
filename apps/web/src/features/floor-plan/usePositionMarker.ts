import { useEffect } from 'react';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import { usePositionMarkerStore } from '@/lib/stores/positionMarkerStore';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

/** Subscribes to the patient-stream's onPositionEstimate channel and
 *  fans rows into the position marker store. Returns the latest
 *  estimate for the current patient (or undefined when none has
 *  arrived yet).
 *
 *  Cleanup: unsubscribes on unmount AND resets the store entry for
 *  this patient so a route change doesn't leak the previous tenant's
 *  marker. */
export function usePositionMarker(): PositionEstimateRow | undefined {
  const { patientId, onPositionEstimate } = usePatientStreamContext();
  const latest = usePositionMarkerStore((s) => s.latestByPatient[patientId]);

  useEffect(() => {
    const unsubscribe = onPositionEstimate((row) => {
      usePositionMarkerStore.getState().pushEstimate(patientId, row);
    });
    return () => {
      unsubscribe();
      usePositionMarkerStore.getState().reset(patientId);
    };
  }, [patientId, onPositionEstimate]);

  return latest;
}
