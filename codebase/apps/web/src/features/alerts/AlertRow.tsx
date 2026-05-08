import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AlertRow as AlertRowT, AlertSeverity } from '@alzcare/shared';
import { AckButton } from './AckButton';

interface AlertRowProps {
  alert: AlertRowT;
  /** When provided, the row links to the patient detail's Alerts tab. */
  patientHref?: string;
  /** Optional title shown above the timestamp — typically the patient
   *  name in the bell popover. Hidden inside the per-patient AlertsTab
   *  where the patient is already in scope. */
  patientLabel?: string;
}

const SEVERITY_STYLE: Record<
  AlertSeverity,
  { bg: string; text: string; Icon: typeof AlertTriangle }
> = {
  info: {
    bg: 'bg-sky-500/10 border-sky-500/30',
    text: 'text-sky-700 dark:text-sky-300',
    Icon: Info,
  },
  warn: {
    bg: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    Icon: Bell,
  },
  critical: {
    bg: 'bg-red-500/10 border-red-500/40',
    text: 'text-red-700 dark:text-red-300',
    Icon: AlertTriangle,
  },
};

export function AlertRow({ alert, patientHref, patientLabel }: AlertRowProps) {
  const { Icon, bg, text } = SEVERITY_STYLE[alert.severity];
  const summary = describeContext(alert);
  return (
    <Card className={cn('border', bg, alert.acknowledged_at == null ? '' : 'opacity-70')}>
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full',
              bg,
              text,
            )}
            aria-hidden
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={cn('text-xs font-semibold uppercase tracking-wide', text)}>
                {alert.severity}
              </span>
              {patientLabel && (
                <span className="truncate text-sm font-medium text-foreground">{patientLabel}</span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(alert.fired_at).toLocaleString()}
              </span>
            </div>
            <p className="truncate text-sm text-foreground">{summary}</p>
            {alert.acknowledged_at && (
              <p className="text-[10px] text-muted-foreground">
                Acknowledged {new Date(alert.acknowledged_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AckButton alert={alert} />
          {patientHref && (
            <Link
              to={patientHref}
              className="text-[10px] text-muted-foreground underline-offset-4 hover:underline"
            >
              Open patient →
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function describeContext(alert: AlertRowT): string {
  const ctx = (alert.context ?? {}) as Record<string, unknown>;
  const kind = ctx.kind as string | undefined;
  switch (kind) {
    case 'vitals':
      return `${ctx.metric ?? 'metric'} = ${ctx.value} (${ctx.breached === 'high' ? 'above' : 'below'} range)`;
    case 'fall':
      return `Fall detected by the wearable.`;
    case 'zone':
      return `Patient ${ctx.direction === 'enter' ? 'entered' : 'left'} a watched zone.`;
    case 'inactivity':
      return `No movement for ${ctx.observed_inactive_seconds ?? '?'} s (threshold ${ctx.inactive_minutes ?? '?'} min).`;
    default:
      return 'Alert fired.';
  }
}
