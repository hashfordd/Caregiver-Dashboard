import { useState } from 'react';
import { BellOff, Pause, Play } from 'lucide-react';
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

export function AlertStream({ rows, isLoading, isError }: AlertStreamProps) {
  const lookup = usePatientsLookup();
  // Pause toggle freezes the visible list so a screen-reader user (or
  // anyone trying to actually read what just fired) can do so without
  // the stream shuffling under them. The underlying TanStack cache
  // continues to update; only the snapshot the panel renders is held.
  const [pausedSnapshot, setPausedSnapshot] = useState<AlertRowT[] | null>(null);
  const visible = (pausedSnapshot ?? rows).slice(0, STREAM_LIMIT);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      aria-label="Recent alerts"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Alert stream
        </h2>
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
      </header>

      {isError && <p className="text-sm text-destructive">Couldn't load the alert stream.</p>}

      {!isError && isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isError && !isLoading && visible.length === 0 && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
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
    </section>
  );
}
