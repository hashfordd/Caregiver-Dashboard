import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveGridRow } from './LiveGridRow';
import type { PatientSituation } from './types';

interface LiveGridProps {
  patients: PatientSituation[];
  unackedAlerts: AlertRow[];
  isLoading: boolean;
  selectedPatientId: string | null;
  onSelect: (patientId: string) => void;
}

// Re-render cadence for relative-time labels ("3s ago"). Independent
// of the data poll — derived purely from the cached timestamps.
const TICK_MS = 1_000;

export function LiveGrid({
  patients,
  unackedAlerts,
  isLoading,
  selectedPatientId,
  onSelect,
}: LiveGridProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="grid gap-2" data-testid="live-grid-loading">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (patients.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="No patients allocated"
        description="Once an admin allocates a patient to your account, they'll appear here in real time."
      />
    );
  }

  // Index unacked alerts by patient → use the most recent one for the
  // inline Ack affordance. The full stream lives in <AlertStream>.
  const latestByPatient = new Map<string, AlertRow>();
  for (const alert of unackedAlerts) {
    const existing = latestByPatient.get(alert.patient_id);
    if (!existing || alert.fired_at > existing.fired_at) {
      latestByPatient.set(alert.patient_id, alert);
    }
  }

  return (
    <div className="grid gap-2">
      {patients.map((patient) => (
        <LiveGridRow
          key={patient.patient_id}
          patient={patient}
          latestUnackedAlert={latestByPatient.get(patient.patient_id) ?? null}
          now={now}
          selected={patient.patient_id === selectedPatientId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
