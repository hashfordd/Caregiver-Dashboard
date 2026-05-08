import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ClipboardList, Pill, X } from 'lucide-react';
import type { AlertRow, Incident, Patient } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatRelativeAge } from './connectionStatus';
import type { PatientSituation } from './types';

interface PatientSideRailProps {
  /** The summary row from the situation overview — drives identity +
   *  connection without an extra fetch. */
  situation: PatientSituation;
  /** Latest 5 unacked alerts for this patient, drawn from the
   *  parent's useAllocatedAlerts. */
  unackedAlerts: AlertRow[];
  onClose: () => void;
}

const PATIENT_DETAIL_KEY = (id: string) => ['patients', 'detail', id] as const;
const RAIL_INCIDENTS_KEY = (id: string) => ['patients', 'incidents', 'rail', id] as const;

const PATIENT_COLUMNS =
  'id, full_name, dob, description, care_provider_id, created_at, ' +
  'dementia_stage, wandering_risk, known_triggers, care_plan_summary, preferences';

export function PatientSideRail({ situation, unackedAlerts, onClose }: PatientSideRailProps) {
  const detail = useQuery({
    queryKey: PATIENT_DETAIL_KEY(situation.patient_id),
    staleTime: 30_000,
    queryFn: async (): Promise<Patient | null> => {
      const { data, error } = await supabase
        .from('patients')
        .select(PATIENT_COLUMNS)
        .eq('id', situation.patient_id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Patient) ?? null;
    },
  });

  const incidents = useQuery({
    queryKey: RAIL_INCIDENTS_KEY(situation.patient_id),
    staleTime: 15_000,
    queryFn: async (): Promise<Incident[]> => {
      const { data, error } = await supabase
        .from('incidents')
        .select(
          'id, patient_id, logged_by, occurred_at, type, severity, description, ' +
            'follow_up_required, resolved_at, created_at, updated_at',
        )
        .eq('patient_id', situation.patient_id)
        .is('resolved_at', null)
        .order('occurred_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as Incident[];
    },
  });

  // Esc closes the rail.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const age = useMemo(() => ageFromDob(detail.data?.dob ?? null), [detail.data?.dob]);
  const patient = detail.data;

  return (
    <aside
      className="flex h-full flex-col gap-4 rounded-lg border bg-card p-4"
      role="complementary"
      aria-label={`Details for ${situation.full_name}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Patient detail
          </p>
          <h2 className="truncate font-serif italic text-2xl text-foreground">
            {situation.full_name}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {age && <span>age {age}</span>}
            <RiskBadgeInline risk={situation.wandering_risk} />
            {patient?.dementia_stage && patient.dementia_stage !== 'unknown' && (
              <span className="capitalize">{patient.dementia_stage} stage</span>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close patient detail"
          className="-mr-2 -mt-1 h-8 w-8 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <Section title="Last seen">
        <p className="text-sm text-foreground">
          {situation.last_position_at
            ? formatRelativeAge(situation.last_position_at)
            : 'No fix yet'}
          {situation.last_position_mode && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({situation.last_position_mode})
            </span>
          )}
        </p>
      </Section>

      <Section title="Unacked alerts" count={unackedAlerts.length}>
        {unackedAlerts.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">No open alerts.</p>
        ) : (
          <ul className="space-y-1.5">
            {unackedAlerts.slice(0, 5).map((a) => (
              <li
                key={a.id}
                className={cn(
                  'rounded border px-2 py-1.5 text-xs',
                  a.severity === 'critical'
                    ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-300'
                    : a.severity === 'warn'
                      ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                      : 'border-border bg-muted/30',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold uppercase tracking-wide">{a.severity}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelativeAge(a.fired_at)}
                  </span>
                </div>
                <p className="truncate">{describeAlert(a)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Open incidents"
        count={incidents.data?.length ?? 0}
        icon={<ClipboardList className="h-3 w-3" />}
      >
        {incidents.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : incidents.data && incidents.data.length > 0 ? (
          <ul className="space-y-1.5">
            {incidents.data.map((i) => (
              <li key={i.id} className="rounded border px-2 py-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold uppercase tracking-wide capitalize">
                    {i.type.replace('_', ' ')}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    sev {i.severity} · {formatRelativeAge(i.occurred_at)}
                  </span>
                </div>
                <p className="line-clamp-2 text-foreground/80">{i.description}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic text-muted-foreground">No unresolved incidents.</p>
        )}
      </Section>

      <Section
        title="Active medications"
        count={situation.active_medications_count}
        icon={<Pill className="h-3 w-3" />}
      >
        <p className="text-xs text-muted-foreground">
          {situation.active_medications_count === 0
            ? 'None on file.'
            : `${situation.active_medications_count} active. Manage on the Meds tab.`}
        </p>
      </Section>

      {patient?.care_plan_summary && (
        <Section title="Care plan">
          <p className="line-clamp-4 text-xs text-foreground/80">{patient.care_plan_summary}</p>
        </Section>
      )}

      <div className="mt-auto border-t border-border/40 pt-3">
        <Link
          to={`/patients/${situation.patient_id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Open full detail
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </aside>
  );
}

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        <span>{title}</span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] font-normal">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function RiskBadgeInline({ risk }: { risk: string }) {
  const variant: 'destructive' | 'secondary' | 'outline' =
    risk === 'high' ? 'destructive' : risk === 'medium' ? 'secondary' : 'outline';
  const label =
    risk === 'high'
      ? 'High risk'
      : risk === 'medium'
        ? 'Medium risk'
        : risk === 'low'
          ? 'Low risk'
          : 'Risk —';
  return (
    <Badge variant={variant} className="h-4 px-1.5 text-[10px]">
      {label}
    </Badge>
  );
}

function ageFromDob(dob: string | null): string | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const years = Math.floor((Date.now() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return `${years}`;
}

function describeAlert(a: AlertRow): string {
  const ctx = (a.context ?? {}) as Record<string, unknown>;
  const kind = ctx.kind as string | undefined;
  switch (kind) {
    case 'vitals':
      return `${ctx.metric ?? 'metric'} = ${ctx.value} (${ctx.breached === 'high' ? 'above' : 'below'} range)`;
    case 'fall':
      return 'Fall detected by the wearable.';
    case 'zone':
      return `Patient ${ctx.direction === 'enter' ? 'entered' : 'left'} a watched zone.`;
    case 'inactivity':
      return `No movement for ${ctx.observed_inactive_seconds ?? '?'} s.`;
    default:
      return 'Alert fired.';
  }
}
