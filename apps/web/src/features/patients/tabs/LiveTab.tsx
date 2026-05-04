import { SensorCard } from '../live/SensorCard';
import { usePatientStreamContext } from '../PatientStreamContext';

// F4 fills this with three sensor cards bound to the live store. F10 will
// add a DevicePairingSlot above the grid for patients with no paired device.
export function LiveTab() {
  const { patientId } = usePatientStreamContext();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <SensorCard patientId={patientId} metric="hr" />
      <SensorCard patientId={patientId} metric="spo2" />
      <SensorCard patientId={patientId} metric="temp" />
      {/* TODO: F10 — DevicePairingSlot when no device is paired. */}
    </div>
  );
}
