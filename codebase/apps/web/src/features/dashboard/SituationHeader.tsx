import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ChevronRight, ClipboardList, Users, WifiOff } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { deriveConnectionStatus } from './connectionStatus';
import type { PatientSituation } from './types';

interface SituationHeaderProps {
  patients: PatientSituation[];
  unackedAlerts: AlertRow[];
  hasCriticalAlert: boolean;
}

interface CounterMatch {
  patient: PatientSituation;
  /** Optional secondary label that explains why this patient matched
   *  ("zone breach 2m ago", "stale 3m", "1 unresolved"). */
  detail?: string;
}

export function SituationHeader({
  patients,
  unackedAlerts,
  hasCriticalAlert,
}: SituationHeaderProps) {
  const groups = useMemo(() => computeMatches(patients, unackedAlerts), [patients, unackedAlerts]);

  return (
    <section
      aria-label="Roster summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
    >
      <Counter icon={<Users className="h-4 w-4" />} label="On roster" value={patients.length} />
      <Counter
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Open alerts"
        value={groups.openAlerts.length}
        tone={groups.openAlerts.length === 0 ? 'neutral' : hasCriticalAlert ? 'critical' : 'warn'}
        matches={groups.openAlerts}
        emptyHint="No open alerts."
      />
      <Counter
        icon={<ClipboardList className="h-4 w-4" />}
        label="Incidents 24h"
        value={groups.incidents.reduce((acc, m) => acc + countFromDetail(m.detail), 0)}
        tone={groups.incidents.length > 0 ? 'warn' : 'neutral'}
        matches={groups.incidents}
        emptyHint="No unresolved incidents in the last 24h."
      />
      <Counter
        icon={<Activity className="h-4 w-4" />}
        label="Stale signal"
        value={groups.stale.length}
        tone={groups.stale.length > 0 ? 'warn' : 'neutral'}
        matches={groups.stale}
        emptyHint="No patients with stale signal."
      />
      <Counter
        icon={<WifiOff className="h-4 w-4" />}
        label="Offline"
        value={groups.offline.length}
        tone={groups.offline.length > 0 ? 'muted-strong' : 'neutral'}
        matches={groups.offline}
        emptyHint="No patients are offline."
      />
    </section>
  );
}

type Tone = 'neutral' | 'warn' | 'critical' | 'muted-strong';

function Counter({
  icon,
  label,
  value,
  tone = 'neutral',
  matches,
  emptyHint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: Tone;
  /** Pass undefined to leave the counter non-interactive (e.g. "On roster"). */
  matches?: CounterMatch[];
  emptyHint?: string;
}) {
  const card = (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-3 text-left transition-colors',
        tone === 'critical' && 'border-red-500/40 bg-red-500/5',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
        tone === 'muted-strong' && 'border-border bg-muted/40',
        matches !== undefined &&
          'cursor-pointer hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p
        className={cn(
          'mt-1 font-serif italic text-3xl tabular-nums',
          tone === 'critical' && 'text-red-700 dark:text-red-300',
          tone === 'warn' && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </p>
    </div>
  );

  if (matches === undefined) return card;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`${label}: ${value} — open list`} className="text-left">
          {card}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {matches.length} {matches.length === 1 ? 'patient' : 'patients'}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {matches.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {emptyHint ?? 'Nothing to show.'}
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border/40 overflow-y-auto">
            {matches.map((m) => (
              <li key={m.patient.patient_id}>
                <Link
                  to={`/patients/${m.patient.patient_id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.patient.full_name}</span>
                    {m.detail && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {m.detail}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MatchGroups {
  openAlerts: CounterMatch[];
  incidents: CounterMatch[];
  stale: CounterMatch[];
  offline: CounterMatch[];
}

function computeMatches(patients: PatientSituation[], unackedAlerts: AlertRow[]): MatchGroups {
  const now = Date.now();

  const alertsByPatient = new Map<string, AlertRow[]>();
  for (const a of unackedAlerts) {
    const list = alertsByPatient.get(a.patient_id) ?? [];
    list.push(a);
    alertsByPatient.set(a.patient_id, list);
  }

  const openAlerts: CounterMatch[] = [];
  const incidents: CounterMatch[] = [];
  const stale: CounterMatch[] = [];
  const offline: CounterMatch[] = [];

  for (const p of patients) {
    const alerts = alertsByPatient.get(p.patient_id) ?? [];
    if (alerts.length > 0) {
      const top = alerts.reduce((a, b) => (a.fired_at > b.fired_at ? a : b));
      openAlerts.push({
        patient: p,
        detail: `${alerts.length} unacked · severest: ${top.severity}`,
      });
    }

    if (p.unresolved_incidents_24h_count > 0) {
      incidents.push({
        patient: p,
        detail: `${p.unresolved_incidents_24h_count} unresolved`,
      });
    }

    const status = deriveConnectionStatus(p.last_position_at, now);
    if (status === 'stale') {
      stale.push({ patient: p, detail: 'last fix >30s ago' });
    } else if (status === 'offline') {
      offline.push({
        patient: p,
        detail: p.last_position_at ? 'last fix >5m ago' : 'never seen',
      });
    }
  }

  return { openAlerts, incidents, stale, offline };
}

/** "3 unresolved" → 3. Used to keep the Incidents counter showing total
 *  incidents (not just affected-patient count) while the popover groups
 *  by patient with a per-row count. */
function countFromDetail(detail: string | undefined): number {
  if (!detail) return 1;
  const match = detail.match(/^(\d+)\s+unresolved/);
  return match ? Number(match[1]) : 1;
}
