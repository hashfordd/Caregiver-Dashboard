import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AckButton } from '@/features/alerts/AckButton';
import { deriveConnectionStatus, formatRelativeAge } from './connectionStatus';
import type { PatientSituation } from './types';

interface LiveGridRowProps {
  patient: PatientSituation;
  /** Most recent unacked alert for this patient, if any. Inline Ack
   *  surfaces the highest-leverage action without forcing a tab jump. */
  latestUnackedAlert: AlertRow | null;
  /** Tick passed in from the parent so all rows share a clock and
   *  re-render together without each one running its own setInterval. */
  now: number;
}

export function LiveGridRow({ patient, latestUnackedAlert, now }: LiveGridRowProps) {
  const status = deriveConnectionStatus(patient.last_position_at, now);
  const lastSeen = formatRelativeAge(patient.last_position_at, now);

  return (
    <Link
      to={`/patients/${patient.patient_id}`}
      className={cn(
        'group/row flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
        latestUnackedAlert?.severity === 'critical' && 'border-red-500/40',
      )}
    >
      <StatusDot status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-medium text-foreground">{patient.full_name}</p>
          <RiskBadge risk={patient.wandering_risk} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {locationSummary(patient)} · {lastSeen}
        </p>
      </div>
      {latestUnackedAlert ? (
        <span
          className="hidden md:block"
          onClick={(e) => {
            // Stop the row-level <Link> from taking the click when the
            // user is just acknowledging.
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <AckButton alert={latestUnackedAlert} />
        </span>
      ) : null}
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" />
    </Link>
  );
}

function StatusDot({ status }: { status: ReturnType<typeof deriveConnectionStatus> }) {
  const label = status === 'online' ? 'Online' : status === 'stale' ? 'Stale signal' : 'Offline';
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
        status === 'online' && 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
        status === 'stale' && 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
        status === 'offline' && 'bg-muted-foreground/40',
      )}
    />
  );
}

function RiskBadge({ risk }: { risk: string }) {
  // PR-1 placeholder. PR-2 introduces the real low/medium/high enum on
  // patients and this branch lights up.
  if (risk === 'high') return <Badge variant="destructive">High risk</Badge>;
  if (risk === 'medium') return <Badge variant="secondary">Medium risk</Badge>;
  if (risk === 'low') return <Badge variant="outline">Low risk</Badge>;
  return <Badge variant="ghost">Risk —</Badge>;
}

function locationSummary(patient: PatientSituation): string {
  if (!patient.last_position_at) return 'No fix yet';
  if (patient.last_position_mode === 'outdoor') return 'Outdoor';
  if (patient.last_position_mode === 'indoor') return 'Indoor';
  return 'Unknown mode';
}
