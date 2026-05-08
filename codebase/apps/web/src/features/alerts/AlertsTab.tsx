import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabase';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import type { AlertRow as AlertRowT, AlertSeverity } from '@alzcare/shared';
import { AlertRow } from './AlertRow';
import { AlertsFilter, type FilterState } from './AlertsFilter';

interface Props {
  patientId: string;
}

const COLUMNS =
  'id, patient_id, rule_id, severity, fired_at, acknowledged_at, ack_by_caregiver_id, context';
const ROW_LIMIT = 200;
const KEY = (patientId: string) => ['alerts', 'patient', patientId] as const;

const ALL_SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];

/** Per-patient alerts feed. Combines an initial 200-row fetch with a
 *  live realtime subscription (already provided by the patient stream
 *  context's onAlert) so newly fired alerts appear within the F12 2 s
 *  budget. Filters are pure client-side and don't change the cache key. */
export function AlertsTab({ patientId }: Props) {
  const { onAlert } = usePatientStreamContext();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterState>({
    severities: new Set(ALL_SEVERITIES),
    state: 'all',
  });

  const query = useQuery({
    queryKey: KEY(patientId),
    queryFn: async (): Promise<AlertRowT[]> => {
      const { data, error } = await supabase
        .from('alerts')
        .select(COLUMNS)
        .eq('patient_id', patientId)
        .order('fired_at', { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as AlertRowT[];
    },
  });

  // Live updates from the existing patient stream — INSERT prepends,
  // UPDATE patches in place. The query cache is the single source of
  // truth; filters apply at render time.
  useEffect(() => {
    const unsubscribe = onAlert((row) => {
      qc.setQueryData<AlertRowT[]>(KEY(patientId), (prev) => {
        const existing = prev?.find((r) => r.id === row.id);
        if (existing) {
          return prev?.map((r) => (r.id === row.id ? row : r)) ?? prev;
        }
        return [row, ...(prev ?? [])].slice(0, ROW_LIMIT);
      });
    });
    return unsubscribe;
  }, [onAlert, patientId, qc]);

  const filtered = useMemo(() => applyFilter(query.data ?? [], filter), [query.data, filter]);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<Bell className="h-10 w-10" />}
        title="Couldn't load alerts"
        description={(query.error as Error).message}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Alerts</h3>
          <p className="text-xs text-muted-foreground">
            Newest first. Acknowledge to clear from the global bell.
          </p>
        </div>
        <AlertsFilter value={filter} onChange={setFilter} />
      </header>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title={query.data?.length ? 'No alerts match the filter' : 'No alerts yet'}
          description={
            query.data?.length
              ? 'Adjust the filter chips to widen the result.'
              : "Configure rules in the Settings tab — they'll fire here."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <AlertRow key={row.id} alert={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function applyFilter(rows: AlertRowT[], filter: FilterState): AlertRowT[] {
  return rows.filter((row) => {
    if (!filter.severities.has(row.severity)) return false;
    if (filter.state === 'active' && row.acknowledged_at != null) return false;
    if (filter.state === 'acknowledged' && row.acknowledged_at == null) return false;
    return true;
  });
}
