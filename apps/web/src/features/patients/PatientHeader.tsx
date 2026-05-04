import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Patient } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { usePatientStreamContext, type PatientStreamContextValue } from './PatientStreamContext';

function ageFromDob(dob: string | null): string | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const years = Math.floor((Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return `${years}`;
}

export function PatientHeader({ patient }: { patient: Patient }) {
  const { status } = usePatientStreamContext();
  const age = ageFromDob(patient.dob);

  return (
    <header className="mb-6">
      <Link
        to="/patients"
        className="inline-flex items-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Roster
      </Link>
      <div className="mt-2 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif italic text-3xl text-foreground">{patient.full_name}</h1>
          {age && <p className="text-sm text-muted-foreground">age {age}</p>}
        </div>
        <ConnectionStatusPill status={status} />
      </div>
    </header>
  );
}

function ConnectionStatusPill({ status }: { status: PatientStreamContextValue['status'] }) {
  switch (status) {
    case 'subscribed':
      return <Badge>Live</Badge>;
    case 'disconnected':
      return <Badge variant="destructive">Disconnected</Badge>;
    case 'error':
      return <Badge variant="destructive">Connection error</Badge>;
    case 'idle':
    default:
      return <Badge variant="secondary">Connecting…</Badge>;
  }
}
