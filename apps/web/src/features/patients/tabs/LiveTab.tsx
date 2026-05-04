import { DevicePairingPanel } from '@/features/devices/DevicePairingPanel';
import { SensorCard } from '../live/SensorCard';
import { usePatientStreamContext } from '../PatientStreamContext';

// F4 fills the sensor cards; F10 fills the device pairing panel.
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
    </div>
  );
}
