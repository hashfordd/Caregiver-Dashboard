import { Suspense, lazy } from 'react';
import { DevicePairingPanel } from '@/features/devices/DevicePairingPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { SensorCard } from '../live/SensorCard';
import { usePatientStreamContext } from '../PatientStreamContext';

// F4 fills the sensor cards; F8's LivePositionView surfaces the floor
// plan + live marker; F10 fills the device pairing panel.
const LivePositionView = lazy(() =>
  import('@/features/floor-plan/LivePositionView').then((m) => ({
    default: m.LivePositionView,
  })),
);

export function LiveTab() {
  const { patientId } = usePatientStreamContext();
  return (
    <div className="space-y-4">
      <DevicePairingPanel patientId={patientId} />
      <div className="grid gap-4 md:grid-cols-3">
        <SensorCard patientId={patientId} metric="hr" />
        <SensorCard patientId={patientId} metric="spo2" />
        <SensorCard patientId={patientId} metric="temp" />
      </div>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
          </div>
        }
      >
        <LivePositionView patientId={patientId} />
      </Suspense>
    </div>
  );
}
