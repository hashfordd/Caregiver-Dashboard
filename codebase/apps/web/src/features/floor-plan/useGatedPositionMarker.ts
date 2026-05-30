import { useEffect } from 'react';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import { useActivity } from '@/features/patients/live/useActivity';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import { useGatedPositionStore, type GatedEstimate } from '@/lib/stores/gatedPositionStore';
import { usePositionMarker } from './usePositionMarker';

/** Like usePositionMarker, but runs the latest estimate through the IMU
 *  motion-gate: a resting patient's marker holds at an anchor instead of
 *  drifting with triangulation noise, while a moving patient tracks with light
 *  smoothing. Returns a row shaped like the raw estimate (with a `held` flag)
 *  so the canvas marker and location context need no shape changes.
 *
 *  Safe to call from several components on the same patient page — the store
 *  advance is idempotent per (recorded_at, activity). */
export function useGatedPositionMarker(): GatedEstimate | undefined {
  const { patientId } = usePatientStreamContext();
  const raw = usePositionMarker();
  const { state: activityState } = useActivity(patientId);
  const planQuery = useFloorPlan(patientId);
  const scale = planQuery.data?.scale_meters_per_pixel ?? null;

  const gated = useGatedPositionStore((s) => s.byPatient[patientId]?.output);

  useEffect(() => {
    useGatedPositionStore.getState().pushRaw(patientId, raw, activityState, scale);
  }, [patientId, raw, activityState, scale]);

  // Fall back to the raw row until the first gate advance settles, and after a
  // patient switch before the store entry exists.
  return gated ?? (raw as GatedEstimate | undefined);
}
