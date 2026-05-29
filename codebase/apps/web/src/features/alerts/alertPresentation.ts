import { AlertTriangle, Bell, Info } from 'lucide-react';
import type { AlertRow as AlertRowT, AlertSeverity } from '@alzcare/shared';

/** Shared severity → colour/icon map and human summary for an alert.
 *  Lives here (rather than in AlertRow) so the row, the bell, and the
 *  pop-up dialog all render the same language without duplicating it. */
export const SEVERITY_STYLE: Record<
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

export function describeAlert(alert: AlertRowT): string {
  const ctx = (alert.context ?? {}) as Record<string, unknown>;
  const kind = ctx.kind as string | undefined;
  switch (kind) {
    case 'vitals':
      return `${ctx.metric ?? 'metric'} = ${ctx.value} (${ctx.breached === 'high' ? 'above' : 'below'} range)`;
    case 'fall':
      return 'Fall detected by the wearable.';
    case 'zone':
      return `Patient ${ctx.direction === 'enter' ? 'entered' : 'left'} a watched zone.`;
    case 'inactivity':
      return `No movement for ${ctx.observed_inactive_seconds ?? '?'} s (threshold ${ctx.inactive_minutes ?? '?'} min).`;
    case 'attention':
      return (
        (typeof ctx.message === 'string' && ctx.message.trim() ? ctx.message.trim() : null) ??
        'Patient requested attention (SOS button).'
      );
    default:
      return 'Alert fired.';
  }
}
