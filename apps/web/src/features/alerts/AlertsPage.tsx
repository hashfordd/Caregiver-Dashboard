import { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertRow } from './AlertRow';
import { AlertsFilter, type FilterState } from './AlertsFilter';
import { useAllocatedAlerts } from './useAllocatedAlerts';
import type { AlertSeverity } from '@alzcare/shared';

const ALL_SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];

/** Cross-patient feed at /alerts. Same data source as the bell — reads
 *  the React Query cache populated by useAllocatedAlerts so navigating
 *  here doesn't re-fetch. Filters mirror the per-patient AlertsTab. */
export function AlertsPage() {
  const { rows, isLoading, isError } = useAllocatedAlerts();
  const [filter, setFilter] = useState<FilterState>({
    severities: new Set<AlertSeverity>(ALL_SEVERITIES),
    state: 'active',
  });

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (!filter.severities.has(row.severity)) return false;
        if (filter.state === 'active' && row.acknowledged_at != null) return false;
        if (filter.state === 'acknowledged' && row.acknowledged_at == null) return false;
        return true;
      }),
    [rows, filter],
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notifications</p>
        <h1 className="font-serif italic text-4xl text-foreground">Alerts</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Every alert across the patients you're allocated to. Configure rules per-patient under
          their <em>Settings</em> tab.
        </p>
      </header>

      <div className="mb-4">
        <AlertsFilter value={filter} onChange={setFilter} />
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {isError && (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title="Couldn't load alerts"
          description="Something went wrong fetching alerts. Try refreshing."
        />
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title={rows.length === 0 ? 'No alerts yet' : 'No alerts match the filter'}
          description={
            rows.length === 0
              ? 'Configure rules per patient — they will fire here.'
              : 'Adjust the chips to widen the result.'
          }
        />
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((row) => (
            <AlertRow
              key={row.id}
              alert={row}
              patientHref={`/patients/${row.patient_id}?tab=alerts`}
              patientLabel={`Patient ${row.patient_id.slice(0, 8)}`}
            />
          ))}
        </div>
      )}
    </main>
  );
}
