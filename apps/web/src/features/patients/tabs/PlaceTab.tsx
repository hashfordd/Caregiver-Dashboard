import { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePatientStreamContext } from '../PatientStreamContext';

// Lazy-load each sub-tab so Fabric.js doesn't ship until the caregiver
// opens Floor plan, and the (eventual) BLE realtime wiring doesn't ship
// until they open Beacons. CROSS_CUTTING §16.
const FloorPlanEditor = lazy(() =>
  import('@/features/floor-plan/FloorPlanEditor').then((m) => ({
    default: m.FloorPlanEditor,
  })),
);

const BeaconsPanel = lazy(() =>
  import('@/features/beacons/BeaconsPanel').then((m) => ({
    default: m.BeaconsPanel,
  })),
);

const PLACE_SUB_TABS = ['floor-plan', 'beacons'] as const;
type PlaceSubTab = (typeof PLACE_SUB_TABS)[number];

function isPlaceSubTab(value: string): value is PlaceSubTab {
  return (PLACE_SUB_TABS as readonly string[]).includes(value);
}

export function PlaceTab() {
  const { patientId } = usePatientStreamContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const subTabParam = searchParams.get('placeTab') ?? 'floor-plan';
  const value: PlaceSubTab = isPlaceSubTab(subTabParam) ? subTabParam : 'floor-plan';

  function setValue(next: string) {
    setSearchParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.set('placeTab', next);
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <Tabs value={value} onValueChange={setValue} className="space-y-3">
      <TabsList>
        <TabsTrigger value="floor-plan">Floor plan</TabsTrigger>
        <TabsTrigger value="beacons">Beacons</TabsTrigger>
      </TabsList>
      <TabsContent value="floor-plan">
        <Suspense
          fallback={
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-[min(82vh,960px)] min-h-[640px] w-full" />
            </div>
          }
        >
          <FloorPlanEditor patientId={patientId} />
        </Suspense>
      </TabsContent>
      <TabsContent value="beacons">
        <Suspense
          fallback={
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          }
        >
          <BeaconsPanel patientId={patientId} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
