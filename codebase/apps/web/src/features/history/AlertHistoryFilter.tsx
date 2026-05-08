import { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatAppTz } from '@/lib/time';
import { useAlertHistory, filterAlerts } from '@/lib/queries/history';
import type { AlertSeverity } from '@alzcare/shared';
import type { AlertHistoryFilters, AlertHistoryRow, AlertRuleType, DateRange } from './types';

interface Props {
  patientId: string;
  range: DateRange;
}

const ALL_SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];
const ALL_RULE_TYPES: AlertRuleType[] = ['zone', 'vitals', 'fall', 'inactivity'];

const SEVERITY_PILLS: { sev: AlertSeverity; label: string; classes: string }[] = [
  { sev: 'info', label: 'info', classes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { sev: 'warn', label: 'warn', classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  { sev: 'critical', label: 'critical', classes: 'bg-red-500/15 text-red-700 dark:text-red-300' },
];

const RULE_TYPE_PILLS: { type: AlertRuleType; label: string }[] = [
  { type: 'zone', label: 'zone' },
  { type: 'vitals', label: 'vitals' },
  { type: 'fall', label: 'fall' },
  { type: 'inactivity', label: 'inactivity' },
];

function defaultFilters(): AlertHistoryFilters {
  return {
    severities: new Set(ALL_SEVERITIES),
    ruleTypes: new Set(ALL_RULE_TYPES),
  };
}

function ContextPreview({ context }: { context: Record<string, unknown> }) {
  const raw = JSON.stringify(context);
  const preview = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
  return <span className="font-mono text-[11px] text-muted-foreground">{preview}</span>;
}

function AckCell({ row }: { row: AlertHistoryRow }) {
  if (!row.acknowledged_at) {
    return <span className="text-muted-foreground">—</span>;
  }
  const short = row.ack_by_caregiver_id?.slice(0, 8) ?? '?';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-300">
        Ack
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{short}</span>
    </span>
  );
}

export function AlertHistoryFilter({ patientId, range }: Props) {
  const [filters, setFilters] = useState<AlertHistoryFilters>(defaultFilters);

  const query = useAlertHistory(patientId, range);

  const filtered = useMemo(() => filterAlerts(query.data ?? [], filters), [query.data, filters]);

  const toggleSeverity = (sev: AlertSeverity) => {
    const next = new Set(filters.severities);
    if (next.has(sev)) next.delete(sev);
    else next.add(sev);
    setFilters((f) => ({ ...f, severities: next }));
  };

  const toggleRuleType = (type: AlertRuleType) => {
    const next = new Set(filters.ruleTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setFilters((f) => ({ ...f, ruleTypes: next }));
  };

  const hasAnyData = (query.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {SEVERITY_PILLS.map((p) => {
            const active = filters.severities.has(p.sev);
            return (
              <button
                key={p.sev}
                type="button"
                onClick={() => toggleSeverity(p.sev)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  active
                    ? `${p.classes} border-transparent`
                    : 'border-border text-muted-foreground',
                )}
                aria-pressed={active}
              >
                {p.label}
              </button>
            );
          })}
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {RULE_TYPE_PILLS.map((p) => {
            const active = filters.ruleTypes.has(p.type);
            return (
              <button
                key={p.type}
                type="button"
                onClick={() => toggleRuleType(p.type)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  active
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground',
                )}
                aria-pressed={active}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </header>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title="Couldn't load alert history"
          description={(query.error as Error).message}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title={hasAnyData ? 'No alerts match the filter' : 'No alerts in this range'}
          description={
            hasAnyData
              ? 'Adjust the severity or rule type chips to widen the result.'
              : 'Try a wider date range or check that rules are configured.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Fired at</th>
                <th className="px-3 py-2">Severity</th>
                <th className="px-3 py-2">Rule type</th>
                <th className="px-3 py-2">Acknowledged</th>
                <th className="px-3 py-2">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">
                    {formatAppTz(row.fired_at)}
                  </td>
                  <td className="px-3 py-2">
                    <SeverityChip severity={row.severity} />
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground">
                    {row.rule_type ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <AckCell row={row} />
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    <ContextPreview context={row.context} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeverityChip({ severity }: { severity: AlertSeverity }) {
  const map: Record<AlertSeverity, string> = {
    info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    critical: 'bg-red-500/15 text-red-700 dark:text-red-300',
  };
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-medium', map[severity])}>
      {severity}
    </span>
  );
}
