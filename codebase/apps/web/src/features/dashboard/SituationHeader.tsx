import { Activity, AlertTriangle, ClipboardList, Users, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SituationHeaderProps {
  patientCount: number;
  openAlertsCount: number;
  staleCount: number;
  offlineCount: number;
  unresolvedIncidentsCount: number;
  hasCriticalAlert: boolean;
}

export function SituationHeader({
  patientCount,
  openAlertsCount,
  staleCount,
  offlineCount,
  unresolvedIncidentsCount,
  hasCriticalAlert,
}: SituationHeaderProps) {
  return (
    <section
      aria-label="Roster summary"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
    >
      <Counter icon={<Users className="h-4 w-4" />} label="On roster" value={patientCount} />
      <Counter
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Open alerts"
        value={openAlertsCount}
        tone={openAlertsCount === 0 ? 'neutral' : hasCriticalAlert ? 'critical' : 'warn'}
      />
      <Counter
        icon={<ClipboardList className="h-4 w-4" />}
        label="Incidents 24h"
        value={unresolvedIncidentsCount}
        tone={unresolvedIncidentsCount > 0 ? 'warn' : 'neutral'}
      />
      <Counter
        icon={<Activity className="h-4 w-4" />}
        label="Stale signal"
        value={staleCount}
        tone={staleCount > 0 ? 'warn' : 'neutral'}
      />
      <Counter
        icon={<WifiOff className="h-4 w-4" />}
        label="Offline"
        value={offlineCount}
        tone={offlineCount > 0 ? 'muted-strong' : 'neutral'}
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
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: Tone;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-3',
        tone === 'critical' && 'border-red-500/40 bg-red-500/5',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5',
        tone === 'muted-strong' && 'border-border bg-muted/40',
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
}
