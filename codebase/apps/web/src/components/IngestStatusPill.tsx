import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { relativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

// The local ingest server (broker + mqtt_bridge) upserts local_ingest_status
// every ~5s. Treat it as online only if the last heartbeat is recent AND the
// broker is connected. Poll on the same cadence so staleness flips us to
// offline a few seconds after the server stops.
const ONLINE_THRESHOLD_MS = 15_000;

interface IngestStatusRow {
  id: string;
  last_seen_at: string;
  broker_connected: boolean;
  bridge_version: string | null;
}

async function fetchIngestStatus(): Promise<IngestStatusRow | null> {
  const { data, error } = await supabase
    .from('local_ingest_status')
    .select('id, last_seen_at, broker_connected, bridge_version')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return (data as IngestStatusRow | null) ?? null;
}

/** Header pill showing whether the paired local ingest server is online. */
export function IngestStatusPill() {
  const { data, isError } = useQuery({
    queryKey: ['local-ingest-status'],
    queryFn: fetchIngestStatus,
    refetchInterval: 5000,
    retry: false,
  });

  // Don't surface RLS / transient errors as a scary state.
  const row = isError ? null : (data ?? null);
  const ageMs = row ? Date.now() - new Date(row.last_seen_at).getTime() : Infinity;
  const fresh = row != null && ageMs < ONLINE_THRESHOLD_MS;
  const state: 'online' | 'degraded' | 'offline' =
    fresh && row?.broker_connected ? 'online' : fresh ? 'degraded' : 'offline';

  const dotClass =
    state === 'online'
      ? 'bg-emerald-500'
      : state === 'degraded'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/40';
  const label =
    state === 'online' ? 'Server online' : state === 'degraded' ? 'Broker down' : 'Server offline';
  const title = row
    ? `Local ingest server — last heartbeat ${relativeTime(row.last_seen_at)}${
        row.broker_connected ? '' : ' · broker not connected'
      }`
    : 'No local server has reported in yet';

  return (
    <span
      title={title}
      aria-label={title}
      className="hidden items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex"
    >
      <span
        className={cn('h-2 w-2 rounded-full', dotClass, state === 'online' && 'animate-pulse')}
      />
      {label}
    </span>
  );
}
