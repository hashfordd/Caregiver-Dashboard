import { useMemo, useCallback } from 'react';
import { Download } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useVitalsHistory, usePositionHistory, useAlertHistory } from '@/lib/queries/history';
import { computeRange, type DateRange, type AlertHistoryFilters } from './types';
import { alertRowsToCsv, positionRowsToCsv, vitalsRowsToCsv } from './csv';

interface Props {
  patientId: string;
}

// All three export cards share the same 24 h window, computed once at
// render time. The range is stable across re-renders via useMemo.
function use24hRange(): DateRange {
  return useMemo(() => {
    const { from, to } = computeRange('24h', Date.now());
    return { preset: '24h', from, to };
  }, []);
}

// Wide-open alert filters — all severities, all rule types.
const ALL_ALERT_FILTERS: AlertHistoryFilters = {
  severities: new Set(['info', 'warn', 'critical']),
  ruleTypes: new Set(['zone', 'vitals', 'fall', 'inactivity', 'repetitive_movement']),
};

function utcDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the browser has time to initiate the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Export card ──────────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  description: string;
  rowCount: number | undefined;
  isLoading: boolean;
  onDownload: () => void;
}

function ExportCard({ title, description, rowCount, isLoading, onDownload }: CardProps) {
  const disabled = isLoading || rowCount === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {isLoading ? (
          <Skeleton className="h-8 w-28 shrink-0" />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onDownload}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download{rowCount != null ? ` (${rowCount})` : ''}
          </button>
        )}
      </div>
      {rowCount === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">No data in the last 24 hours.</p>
      )}
    </div>
  );
}

// ── Main export surface ──────────────────────────────────────────────────────

export function CsvExport({ patientId }: Props) {
  const range = use24hRange();
  const date = utcDateStamp();

  const vitals = useVitalsHistory(patientId, range);
  const positions = usePositionHistory(patientId, range);
  const alerts = useAlertHistory(patientId, range, ALL_ALERT_FILTERS);

  const handleVitals = useCallback(() => {
    if (!vitals.data?.length) return;
    triggerDownload(vitalsRowsToCsv(vitals.data), `alzcare-${patientId}-vitals-${date}.csv`);
  }, [vitals.data, patientId, date]);

  const handlePositions = useCallback(() => {
    if (!positions.data?.length) return;
    triggerDownload(
      positionRowsToCsv(positions.data),
      `alzcare-${patientId}-positions-${date}.csv`,
    );
  }, [positions.data, patientId, date]);

  const handleAlerts = useCallback(() => {
    if (!alerts.data?.length) return;
    triggerDownload(alertRowsToCsv(alerts.data), `alzcare-${patientId}-alerts-${date}.csv`);
  }, [alerts.data, patientId, date]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <ExportCard
          title="Last 24 h — Vitals"
          description="Heart rate, SpO2, and temperature. temp_c is always Celsius."
          rowCount={vitals.data?.length}
          isLoading={vitals.isLoading}
          onDownload={handleVitals}
        />
        <ExportCard
          title="Last 24 h — Positions"
          description="Indoor (x_canvas / y_canvas) and outdoor (lat / lng) position estimates."
          rowCount={positions.data?.length}
          isLoading={positions.isLoading}
          onDownload={handlePositions}
        />
        <ExportCard
          title="Last 24 h — Alerts"
          description="All fired alerts with acknowledgement status."
          rowCount={alerts.data?.length}
          isLoading={alerts.isLoading}
          onDownload={handleAlerts}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Timestamps are UTC. Your spreadsheet may convert to local time on open.
      </p>
    </div>
  );
}
