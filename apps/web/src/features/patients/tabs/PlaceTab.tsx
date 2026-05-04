import { Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { usePatientStreamContext } from '../PatientStreamContext';

// Lazy-load the F5 floor plan editor so Fabric.js is not in the initial
// dashboard bundle. CROSS_CUTTING §16 — Fabric is roughly 100 KB gzipped
// and only loaded once a caregiver actually opens the Place tab.
const FloorPlanEditor = lazy(() =>
  import('@/features/floor-plan/FloorPlanEditor').then((m) => ({
    default: m.FloorPlanEditor,
  })),
);

export function PlaceTab() {
  const { patientId } = usePatientStreamContext();
  return (
    <Suspense
      fallback={
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      }
    >
      <FloorPlanEditor patientId={patientId} />
    </Suspense>
  );
}
