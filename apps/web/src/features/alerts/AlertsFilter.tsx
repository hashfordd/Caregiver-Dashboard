import type { AlertSeverity } from '@alzcare/shared';
import { cn } from '@/lib/utils';

export type AlertStateFilter = 'all' | 'active' | 'acknowledged';

export interface FilterState {
  severities: Set<AlertSeverity>;
  state: AlertStateFilter;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
}

const SEVERITY_PILLS: { sev: AlertSeverity; label: string; classes: string }[] = [
  { sev: 'info', label: 'info', classes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { sev: 'warn', label: 'warn', classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  {
    sev: 'critical',
    label: 'critical',
    classes: 'bg-red-500/15 text-red-700 dark:text-red-300',
  },
];

const STATE_PILLS: { state: AlertStateFilter; label: string }[] = [
  { state: 'all', label: 'All' },
  { state: 'active', label: 'Active' },
  { state: 'acknowledged', label: 'Acknowledged' },
];

export function AlertsFilter({ value, onChange }: Props) {
  const toggleSeverity = (sev: AlertSeverity) => {
    const next = new Set(value.severities);
    if (next.has(sev)) next.delete(sev);
    else next.add(sev);
    onChange({ ...value, severities: next });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SEVERITY_PILLS.map((p) => {
        const active = value.severities.has(p.sev);
        return (
          <button
            key={p.sev}
            type="button"
            onClick={() => toggleSeverity(p.sev)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
              active ? `${p.classes} border-transparent` : 'border-border text-muted-foreground',
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
      {STATE_PILLS.map((p) => {
        const active = value.state === p.state;
        return (
          <button
            key={p.state}
            type="button"
            onClick={() => onChange({ ...value, state: p.state })}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
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
  );
}
