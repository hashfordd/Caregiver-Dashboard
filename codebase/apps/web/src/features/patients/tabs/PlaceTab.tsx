import { Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePatientStreamContext } from '../PatientStreamContext';

// Lazy-load the workspace so Fabric.js (and the BLE realtime wiring) only
// ship once the caregiver opens the Place tab. CROSS_CUTTING §16.
const PlaceWorkspace = lazy(() =>
  import('@/features/place/PlaceWorkspace').then((m) => ({
    default: m.PlaceWorkspace,
  })),
);

/** Place tab: a single workspace that unifies floor-plan drawing, beacon
 *  placement, room/door definition, and calibration capture over one
 *  persistent canvas — no sub-tab switching, no canvas remounts. */
export function PlaceTab() {
  const { patientId } = usePatientStreamContext();
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[min(82vh,960px)] min-h-[640px] w-full" />
        </div>
      }
    >
      <PlaceWorkspace patientId={patientId} />
    </Suspense>
  );
}
