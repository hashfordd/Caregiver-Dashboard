import { Link } from 'react-router-dom';
import { HeartPulse } from 'lucide-react';
import type { AlertRow } from '@alzcare/shared';
import { useAllocatedAlerts } from '@/features/alerts/useAllocatedAlerts';
import { AckButton } from '@/features/alerts/AckButton';
import { SEVERITY_STYLE, describeAlert } from '@/features/alerts/alertPresentation';
import { usePatientsLookup } from '@/features/patients/usePatientsLookup';
import { useLiveSensorStore } from '@/lib/stores/liveSensorStore';
import { useNow } from '@/lib/useNow';

const SEVERITY_RANK: Record<string, number> = { warn: 2, info: 1 };

/** The banner is the amber (warn/info) channel that lives under the header
 *  at all times. Critical (red) alerts are excluded here — they take over
 *  the whole screen via CriticalAlertOverlay — so the highest-priority
 *  non-critical unacked alert is the one shown. */
export function pickBannerAlert(unacked: AlertRow[]): AlertRow | null {
  const candidates = unacked.filter((a) => a.severity !== 'critical');
  if (candidates.length === 0) return null;
  return candidates.reduce((best, curr) => {
    const bRank = SEVERITY_RANK[best.severity] ?? 0;
    const cRank = SEVERITY_RANK[curr.severity] ?? 0;
    if (cRank > bRank) return curr;
    if (cRank === bRank && curr.fired_at > best.fired_at) return curr;
    return best;
  });
}

function HrChip({ patientId }: { patientId: string }) {
  // useNow drives a re-render on each tick so the displayed value reflects
  // the latest reading pushed into the store while this banner is visible.
  useNow(1000);
  const hr = useLiveSensorStore((s) => s.cards[patientId]?.hr?.latest?.value ?? null);
  if (hr == null) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
      <HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />
      {Math.round(hr)} bpm
    </span>
  );
}

export function AlertBanner() {
  const { rows } = useAllocatedAlerts();
  const { resolve } = usePatientsLookup();

  const unacked = rows.filter((r) => r.acknowledged_at == null);
  const alert = pickBannerAlert(unacked);

  if (!alert) return null;

  // Count only the other non-critical alerts — criticals have their own
  // full-screen surface, so they don't inflate the banner's "+N more".
  const moreCount = unacked.filter((a) => a.severity !== 'critical').length - 1;
  const { bg, text, Icon } = SEVERITY_STYLE[alert.severity];

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="alert-banner"
      className={`sticky top-0 z-40 flex items-center gap-3 border-b px-4 py-2 text-sm font-medium shadow-sm ${bg} ${text}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link
          to={`/patients/${alert.patient_id}?tab=alerts`}
          className="shrink-0 font-semibold underline-offset-2 hover:underline"
        >
          {resolve(alert.patient_id)}
        </Link>
        <span className="truncate opacity-90">{describeAlert(alert)}</span>
        {moreCount > 0 && (
          <span className="shrink-0 rounded-full bg-current/10 px-1.5 py-0.5 text-xs opacity-80">
            +{moreCount} more
          </span>
        )}
      </span>

      <HrChip patientId={alert.patient_id} />

      {/* Wrap in a span so the link above is not a descendant of a button
          (AckButton renders a <button>); no nested interactive elements. */}
      <span onClick={(e) => e.stopPropagation()}>
        <AckButton alert={alert} size="sm" variant="outline" />
      </span>
    </div>
  );
}
