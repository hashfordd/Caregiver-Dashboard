import { Suspense, lazy } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { LivePositionView } from './LivePositionView';
import { usePositionMarker } from './usePositionMarker';

// Lazy-load the outdoor map — Mapbox GL is ~200 KB gzipped and only
// needed when the patient is actually outdoors. The indoor view is
// the steady-state for most sessions; we don't want it paying the
// Mapbox cost on every mount.
const OutdoorMapView = lazy(() =>
  import('@/features/map/OutdoorMapView').then((m) => ({
    default: m.OutdoorMapView,
  })),
);

interface PatientPositionViewProps {
  patientId: string;
}

/** Mode-router for the Live tab's position panel. Observes the latest
 *  position estimate's `mode` (driven by F8's POS-08 hysteresis) and
 *  renders either the indoor floor plan or the outdoor map.
 *
 *  The decision to switch lives entirely in F8 — this component is a
 *  pure consumer of the `mode` field. If F8's hysteresis is broken,
 *  this view will visibly flap; that's a deliberate symptom that
 *  catches the bug. */
export function PatientPositionView({ patientId }: PatientPositionViewProps) {
  const estimate = usePositionMarker();

  if (estimate?.mode === 'outdoor') {
    return (
      <Suspense fallback={<PositionSkeleton />}>
        <OutdoorMapView patientId={patientId} estimate={estimate} />
      </Suspense>
    );
  }

  return <LivePositionView patientId={patientId} />;
}

function PositionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
    </div>
  );
}
