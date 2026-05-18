import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LivePositionView } from './LivePositionView';
import { usePositionMarker } from './usePositionMarker';

// Lazy-load the outdoor map — Mapbox GL is ~200 KB gzipped and only
// needed when the caregiver flips to the outdoor view.
const OutdoorMapView = lazy(() =>
  import('@/features/map/OutdoorMapView').then((m) => ({
    default: m.OutdoorMapView,
  })),
);

interface PatientPositionViewProps {
  patientId: string;
}

const VIEW_OPTIONS = ['indoor', 'outdoor'] as const;
type View = (typeof VIEW_OPTIONS)[number];

function isView(value: string): value is View {
  return (VIEW_OPTIONS as readonly string[]).includes(value);
}

/** Live tab's position panel. Caregiver picks between the indoor floor
 *  plan and the outdoor Mapbox view via a segmented toggle; the choice
 *  persists in the URL as `?livePos=indoor|outdoor` so a refresh or a
 *  shared link land on the same view. */
export function PatientPositionView({ patientId }: PatientPositionViewProps) {
  const estimate = usePositionMarker();
  const [searchParams, setSearchParams] = useSearchParams();
  const paramValue = searchParams.get('livePos') ?? 'indoor';
  const view: View = isView(paramValue) ? paramValue : 'indoor';

  function setView(next: string) {
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('livePos', next);
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <div className="space-y-3">
      <Tabs value={view} onValueChange={setView}>
        <TabsList>
          <TabsTrigger value="indoor">Floor plan</TabsTrigger>
          <TabsTrigger value="outdoor">Outdoor map</TabsTrigger>
        </TabsList>
      </Tabs>

      {view === 'outdoor' ? (
        <Suspense fallback={<PositionSkeleton />}>
          <OutdoorMapView patientId={patientId} estimate={estimate} />
        </Suspense>
      ) : (
        <LivePositionView patientId={patientId} />
      )}
    </div>
  );
}

function PositionSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
    </div>
  );
}
