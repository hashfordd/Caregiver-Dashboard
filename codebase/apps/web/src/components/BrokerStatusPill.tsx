import { useBroker, type BrokerStatus } from '@/lib/broker/BrokerProvider';
import { cn } from '@/lib/utils';

// Companion to IngestStatusPill: that one shows the bridge↔broker persistence
// link (from the heartbeat); this shows the browser↔broker LIVE FEED — the
// direct, low-latency telemetry stream the dashboard subscribes to. Click to
// retry when it has errored or dropped.
const META: Record<BrokerStatus, { label: string; dot: string; pulse?: boolean }> = {
  connected: { label: 'Live feed', dot: 'bg-emerald-500', pulse: true },
  connecting: { label: 'Connecting…', dot: 'bg-amber-500', pulse: true },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-amber-500', pulse: true },
  error: { label: 'Feed error', dot: 'bg-destructive' },
  idle: { label: 'Feed off', dot: 'bg-muted-foreground/40' },
  unconfigured: { label: 'Feed off', dot: 'bg-muted-foreground/40' },
};

export function BrokerStatusPill() {
  const { status, error, connect, host } = useBroker();

  // Nothing to show when no credential is configured — keep the navbar clean.
  if (status === 'unconfigured') return null;

  const meta = META[status];
  const retryable = status === 'error' || status === 'idle';
  const title =
    status === 'connected'
      ? `Live telemetry feed connected${host ? ` — ${host}` : ''}`
      : status === 'error'
        ? `Live feed error: ${error ?? 'unknown'} — click to retry`
        : retryable
          ? 'Live feed off — click to connect'
          : `Live feed ${status}`;

  const className = cn(
    'hidden items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex',
    retryable && 'cursor-pointer hover:bg-muted/60',
  );
  const dot = (
    <span className={cn('h-2 w-2 rounded-full', meta.dot, meta.pulse && 'animate-pulse')} />
  );

  if (retryable) {
    return (
      <button
        type="button"
        onClick={() => connect()}
        title={title}
        aria-label={title}
        className={className}
      >
        {dot}
        {meta.label}
      </button>
    );
  }
  return (
    <span title={title} aria-label={title} className={className}>
      {dot}
      {meta.label}
    </span>
  );
}
