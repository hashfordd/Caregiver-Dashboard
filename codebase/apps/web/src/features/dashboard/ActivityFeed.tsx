import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, ClipboardList, NotebookText, Pill } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatRelativeAge } from './connectionStatus';

type ActivityKind = 'incident' | 'medication' | 'note';

interface ActivityRow {
  activity_id: string;
  patient_id: string;
  patient_name: string;
  kind: ActivityKind;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  summary: string;
}

const POLL_INTERVAL_MS = 10_000;
const KEY = ['dashboard', 'recent-activity'] as const;

const KIND_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  incident: ClipboardList,
  medication: Pill,
  note: NotebookText,
};

const KIND_TONE: Record<ActivityKind, string> = {
  incident: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  medication: 'text-sky-700 bg-sky-500/10 dark:text-sky-300',
  note: 'text-muted-foreground bg-muted',
};

const KIND_LABEL: Record<ActivityKind, string> = {
  incident: 'Incident',
  medication: 'Medication',
  note: 'Note',
};

export function ActivityFeed() {
  const query = useQuery({
    queryKey: KEY,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase.rpc('get_recent_activity');
      if (error) throw error;
      return (data ?? []) as ActivityRow[];
    },
  });

  const rows = query.data ?? [];

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      aria-label="Recent activity"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Activity
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'event' : 'events'}
        </span>
      </header>

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {query.isError && (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <p className="py-4 text-sm text-muted-foreground">
          No incidents, doses, or notes logged recently.
        </p>
      )}

      {rows.length > 0 && (
        <ol className="flex max-h-[36rem] flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
          {rows.map((row) => (
            <ActivityItem key={`${row.kind}:${row.activity_id}`} row={row} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  const Icon = KIND_ICON[row.kind] ?? Activity;
  return (
    <li>
      <Link
        to={`/patients/${row.patient_id}?tab=${row.kind === 'note' ? 'notes' : row.kind === 'medication' ? 'meds' : 'incidents'}`}
        className="group/activity block rounded-md border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-muted/40"
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
              KIND_TONE[row.kind],
            )}
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[row.kind]}
              </span>
              <span className="truncate text-sm font-medium text-foreground">
                {row.patient_name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {formatRelativeAge(row.occurred_at)}
              </span>
            </div>
            <p className="line-clamp-2 text-xs text-foreground/80">{row.summary}</p>
            {row.actor_name && (
              <p className="text-[10px] text-muted-foreground">by {row.actor_name}</p>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
