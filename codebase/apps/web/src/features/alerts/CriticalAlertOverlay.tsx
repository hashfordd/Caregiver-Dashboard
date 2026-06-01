import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import { useAllocatedAlerts } from '@/features/alerts/useAllocatedAlerts';
import { AckButton } from '@/features/alerts/AckButton';
import { describeAlert } from '@/features/alerts/alertPresentation';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';

/** Newest unacked critical first. */
export function pickCriticalAlerts(rows: AlertRow[]): AlertRow[] {
  return rows
    .filter((r) => r.severity === 'critical' && r.acknowledged_at == null)
    .sort((a, b) => (a.fired_at < b.fired_at ? 1 : a.fired_at > b.fired_at ? -1 : 0));
}

/** Full-screen red takeover shown whenever ANY allocated patient has an
 *  unacked critical alert. Unlike the transient pop-up (new arrivals only),
 *  this persists across routes until every critical is acknowledged — so a
 *  caregiver cannot miss a critical event. Sits above the amber under-header
 *  banner (z-40) and ordinary dialogs (z-50). */
export function CriticalAlertOverlay() {
  const { rows } = useAllocatedAlerts();
  const { resolve } = usePatientsLookup();
  const navigate = useNavigate();

  const criticals = pickCriticalAlerts(rows);
  const alert = criticals[0];
  if (!alert) return null;

  const remaining = criticals.length - 1;
  const patientName = resolve(alert.patient_id);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-atomic="true"
      aria-label={`Critical alert — ${patientName}`}
      data-testid="critical-alert-overlay"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-red-950/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border-2 border-red-500 bg-card p-6 shadow-2xl ring-4 ring-red-500/30">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-12 w-12 shrink-0 animate-pulse items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400"
            aria-hidden
          >
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-red-700 dark:text-red-300">
              Critical alert
            </h2>
            <Link
              to={`/patients/${alert.patient_id}?tab=alerts`}
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              {patientName}
            </Link>
          </div>
        </div>

        <p className="mt-4 text-sm text-foreground">{describeAlert(alert)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(alert.fired_at).toLocaleString()}
        </p>

        {remaining > 0 && (
          <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
            +{remaining} more critical alert{remaining > 1 ? 's' : ''} waiting
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={() => navigate(`/patients/${alert.patient_id}?tab=alerts`)}
          >
            Jump to patient
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <AckButton alert={alert} variant="default" size="default" />
        </div>
      </div>
    </div>
  );
}
