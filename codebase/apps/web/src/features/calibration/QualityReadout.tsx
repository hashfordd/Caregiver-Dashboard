import { MIN_SAMPLES_TOTAL } from './calibrationAggregator';

export type CaptureStatus =
  | 'idle'
  | 'capturing'
  | 'extending'
  | 'finalising'
  | 'success'
  | 'failed';

export interface QualitySnapshot {
  /** Total raw samples accumulated so far. */
  total: number;
  ble: number;
  wifi: number;
  /** Top-3 strongest BLE entries with their current stddev — useful
   *  during capture to see which beacon is destabilising the window. */
  topBle: { mac: string; rssi_mean: number; rssi_stddev: number; sample_count: number }[];
}

interface QualityReadoutProps {
  status: CaptureStatus;
  snapshot: QualitySnapshot | null;
  /** Last failure reason (only meaningful when status === 'failed'). */
  reason?: string;
  /** Stream connection status forwarded from PatientStream. Helps the
   *  caregiver distinguish "no signals because the wearable is off" from
   *  "no signals because the broker dropped". */
  streamStatus: 'idle' | 'subscribed' | 'disconnected' | 'error';
  /** Phase F item 53: seconds left in the current capture window
   *  (initial or extended). The status pill reads "Capturing… 3 s
   *  left" or "Extending… 4 s left" so caregivers know how long to
   *  hold still. */
  secondsRemaining?: number;
}

export function QualityReadout({
  status,
  snapshot,
  reason,
  streamStatus,
  secondsRemaining,
}: QualityReadoutProps) {
  const total = snapshot?.total ?? 0;
  const pct = Math.min(100, Math.round((total / MIN_SAMPLES_TOTAL) * 100));
  return (
    <div className="space-y-2 rounded-md border border-border bg-card/60 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{statusLabel(status, secondsRemaining)}</span>
        <span className="text-muted-foreground">
          stream: <span className="font-mono">{streamStatus}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {total}/{MIN_SAMPLES_TOTAL}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>BLE {snapshot?.ble ?? 0}</span>
        <span>WiFi {snapshot?.wifi ?? 0}</span>
      </div>
      {snapshot && snapshot.topBle.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
          {snapshot.topBle.map((s) => (
            <li key={s.mac}>
              {s.mac}: μ={s.rssi_mean.toFixed(1)} σ={s.rssi_stddev.toFixed(1)} (n={s.sample_count})
            </li>
          ))}
        </ul>
      )}
      {status === 'failed' && reason && <p className="text-destructive">{reasonLabel(reason)}</p>}
    </div>
  );
}

function statusLabel(status: CaptureStatus, secondsRemaining: number | undefined): string {
  const remaining =
    typeof secondsRemaining === 'number' && secondsRemaining > 0
      ? ` ${secondsRemaining}s left`
      : '';
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'capturing':
      return `Capturing…${remaining}`;
    case 'extending':
      return `Extending window…${remaining}`;
    case 'finalising':
      return 'Finalising…';
    case 'success':
      return 'Captured';
    case 'failed':
      return 'Capture failed';
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'sample_count_below_threshold':
      return 'Signal too sparse — verify the wearable is on and try again.';
    case 'unstable_signal':
      return 'Signal too unstable — keep the wearable still and try again.';
    case 'no_signals':
      return 'No signals received in the capture window.';
    case 'stream_disconnected':
      return 'Realtime stream disconnected — try again once it reconnects.';
    default:
      return reason;
  }
}
