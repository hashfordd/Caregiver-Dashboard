import { useState } from 'react';
import { ChevronLeft, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Patient } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { EditPatientDialog } from './EditPatientDialog';
import { usePatientStreamContext, type PatientStreamContextValue } from './PatientStreamContext';

// Connection pill freshness threshold: if the channel reports
// "subscribed" but no sensor or position update has arrived in this
// window, downgrade the pill to "Idle" — a stuck-but-quiet stream
// looks identical to a healthy one without this gate.
const STALE_THRESHOLD_MS = 60_000;

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
  const { status, lastSeen } = usePatientStreamContext();
  const [editOpen, setEditOpen] = useState(false);
  const age = ageFromDob(patient.dob);
  // Tick every 5 s so the pill flips to "Idle" when sensor data goes
  // quiet without requiring a fresh status callback from the channel.
  const now = useNow(5_000);

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
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-space-400 font-serif italic text-2xl text-eggshell-500"
          >
            {initials(patient.full_name)}
          </div>
          <div>
            <h1 className="font-serif italic text-4xl text-foreground">{patient.full_name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              {age && <span>age {age}</span>}
              {patient.description && (
                <>
                  <span aria-hidden>·</span>
                  <span className="max-w-md truncate">{patient.description}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditOpen(true)}
            aria-label="Edit patient"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <ConnectionStatusPill status={status} lastSeen={lastSeen} now={now} />
        </div>
      </div>
      <EditPatientDialog open={editOpen} onOpenChange={setEditOpen} patient={patient} />
    </header>
  );
}

interface PillProps {
  status: PatientStreamContextValue['status'];
  lastSeen: PatientStreamContextValue['lastSeen'];
  now: number;
}

function ConnectionStatusPill({ status, lastSeen, now }: PillProps) {
  // "Live" requires both: (1) the channel says subscribed, and
  // (2) at least one sensor or position update arrived recently.
  const freshest = Math.max(lastSeen.sensor ?? 0, lastSeen.position ?? 0);
  const ageMs = freshest > 0 ? now - freshest : Infinity;
  const isStale = freshest > 0 && ageMs > STALE_THRESHOLD_MS;
  const subscribedButQuiet = status === 'subscribed' && (freshest === 0 || isStale);

  const dotClass = cn(
    'inline-block h-2 w-2 rounded-full',
    status === 'subscribed' && !subscribedButQuiet && 'bg-accent',
    subscribedButQuiet && 'bg-amber-500',
    status === 'idle' && 'bg-muted-foreground/40 animate-pulse',
    (status === 'disconnected' || status === 'error') && 'bg-destructive',
  );

  const label = (() => {
    if (subscribedButQuiet) return freshest === 0 ? 'Idle (no data yet)' : 'Idle';
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

  const tooltip = freshest > 0 ? `Last update ${Math.round(ageMs / 1000)}s ago` : undefined;

  return (
    <Badge variant={variant} className="gap-1.5" title={tooltip}>
      <span className={dotClass} aria-hidden />
      {label}
    </Badge>
  );
}
