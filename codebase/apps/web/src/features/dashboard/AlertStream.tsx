import { useState } from 'react';
import { BellOff, ChevronDown, ChevronRight, Pause, Play } from 'lucide-react';
import type { AlertRow as AlertRowT } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import { AlertRow } from '@/features/alerts/AlertRow';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';

interface AlertStreamProps {
  rows: AlertRowT[];
  isLoading: boolean;
  isError: boolean;
}

const STREAM_LIMIT = 15;
const COLLAPSE_KEY = 'alzcare:alertStream:collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AlertStream({ rows, isLoading, isError }: AlertStreamProps) {
  const lookup = usePatientsLookup();
  // Pause toggle freezes the visible list so a screen-reader user (or
  // anyone trying to actually read what just fired) can do so without
  // the stream shuffling under them. The underlying TanStack cache
  // continues to update; only the snapshot the panel renders is held.
  const [pausedSnapshot, setPausedSnapshot] = useState<AlertRowT[] | null>(null);
  // Collapsed state is persisted so a caregiver who keeps the stream
  // tucked away (e.g. while watching the grid) doesn't re-close it every
  // visit. The unacked count stays visible while collapsed so nothing
  // urgent hides behind the chevron.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed() {
    setCollapsed((cur) => {
      const next = !cur;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* storage disabled (private mode) — the in-memory toggle still works */
      }
      return next;
    });
  }

  const visible = (pausedSnapshot ?? rows).slice(0, STREAM_LIMIT);
  const unacked = rows.filter((r) => r.acknowledged_at == null).length;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border bg-card p-3"
      aria-label="Recent alerts"
    >
      <header className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Alert stream
          </h2>
          {unacked > 0 && (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-red-700 dark:text-red-300"
              aria-label={`${unacked} unacknowledged`}
            >
              {unacked}
            </span>
          )}
        </button>
        {!collapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setPausedSnapshot((cur) => (cur ? null : rows))}
            aria-pressed={pausedSnapshot !== null}
          >
            {pausedSnapshot ? (
              <>
                <Play className="h-3.5 w-3.5" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause updates
              </>
            )}
          </Button>
        )}
      </header>

      {!collapsed && (
        <>
          {isError && <p className="text-sm text-destructive">Couldn't load the alert stream.</p>}

          {!isError && isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!isError && !isLoading && visible.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <BellOff className="h-4 w-4" />
              <span>No recent alerts. Quiet patients are happy patients.</span>
            </div>
          )}

          {visible.length > 0 && (
            <div
              className="flex flex-col gap-2"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              {visible.map((row) => (
                <AlertRow
                  key={row.id}
                  alert={row}
                  patientHref={`/patients/${row.patient_id}?tab=alerts`}
                  patientLabel={lookup.resolve(row.patient_id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
