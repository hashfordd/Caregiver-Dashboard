import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Patient } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { usePatientStreamContext, type PatientStreamContextValue } from './PatientStreamContext';

function ageFromDob(dob: string | null): string | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const years = Math.floor((Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return `${years}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function PatientHeader({ patient }: { patient: Patient }) {
  const { status } = usePatientStreamContext();
  const age = ageFromDob(patient.dob);

  return (
    <header className="mb-6 border-b border-border/60 pb-6">
      <Link
        to="/patients"
        className="inline-flex items-center text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
        Roster
      </Link>
      <div className="mt-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-space-400 font-serif italic text-2xl text-foreground"
          >
            {initials(patient.full_name)}
          </div>
          <div>
            <h1 className="font-serif italic text-4xl text-foreground">{patient.full_name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              {age && <span>age {age}</span>}
              {patient.notes && (
                <>
                  <span aria-hidden>·</span>
                  <span className="max-w-md truncate">{patient.notes}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <ConnectionStatusPill status={status} />
      </div>
    </header>
  );
}

function ConnectionStatusPill({ status }: { status: PatientStreamContextValue['status'] }) {
  const dotClass = cn(
    'inline-block h-2 w-2 rounded-full',
    status === 'subscribed' && 'bg-accent',
    status === 'idle' && 'bg-muted-foreground/40 animate-pulse',
    (status === 'disconnected' || status === 'error') && 'bg-destructive',
  );

  const label = (() => {
    switch (status) {
      case 'subscribed':
        return 'Live';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Error';
      case 'idle':
      default:
        return 'Connecting…';
    }
  })();

  const variant: 'outline' | 'destructive' =
    status === 'error' || status === 'disconnected' ? 'destructive' : 'outline';

  return (
    <Badge variant={variant} className="gap-1.5">
      <span className={dotClass} aria-hidden />
      {label}
    </Badge>
  );
}
