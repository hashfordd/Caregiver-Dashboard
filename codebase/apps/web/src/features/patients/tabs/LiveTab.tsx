import { Suspense, lazy } from 'react';
import { DevicePairingPanel } from '@/features/devices/DevicePairingPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { SensorCard } from '../live/SensorCard';
import { MovementCard } from '../live/MovementCard';
import { usePatientStreamContext } from '../PatientStreamContext';

// PatientPositionView mode-routes between F8's indoor floor-plan view
// and F9's outdoor map. It pulls the latest estimate via usePositionMarker
// (refcounted in the store) so consumers can mount it freely.
const PatientPositionView = lazy(() =>
  import('@/features/floor-plan/PatientPositionView').then((m) => ({
    default: m.PatientPositionView,
  })),
);

export function LiveTab() {
  const { patientId } = usePatientStreamContext();
  return (
    <div className="space-y-4">
      <DevicePairingPanel patientId={patientId} />
      {/* The wearable reports heart rate + a 6-axis IMU (no SpO₂/temperature),
          so the live vitals surface is heart rate plus a derived movement card. */}
      <div className="grid gap-4 sm:max-w-xl sm:grid-cols-2">
        <SensorCard patientId={patientId} metric="hr" />
        <MovementCard patientId={patientId} />
      </div>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
          </div>
        }
      >
        <PatientPositionView patientId={patientId} />
      </Suspense>
    </div>
  );
}
