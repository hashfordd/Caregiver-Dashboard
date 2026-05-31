import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AlertRow as AlertRowT } from '@alzcare/shared';
import { AckButton } from './AckButton';
import { SEVERITY_STYLE, describeAlert } from './alertPresentation';

interface AlertRowProps {
  alert: AlertRowT;
  /** When provided, the row links to the patient detail's Alerts tab. */
  patientHref?: string;
  /** Optional title shown above the timestamp — typically the patient
   *  name in the bell popover. Hidden inside the per-patient AlertsTab
   *  where the patient is already in scope. */
  patientLabel?: string;
}

export function AlertRow({ alert, patientHref, patientLabel }: AlertRowProps) {
  const { Icon, bg, text } = SEVERITY_STYLE[alert.severity];
  const summary = describeAlert(alert);
  return (
    <Card
      className={cn('border gap-0 py-0', bg, alert.acknowledged_at == null ? '' : 'opacity-70')}
    >
      <CardContent className="flex items-start justify-between gap-2.5 p-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span
            className={cn(
              'mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full',
              bg,
              text,
            )}
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
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
