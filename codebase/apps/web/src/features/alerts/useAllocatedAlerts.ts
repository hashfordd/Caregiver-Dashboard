import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertRow } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { subscribeWithRetry } from '@/lib/subscribeWithRetry';
import { useAuth } from '@/features/auth/AuthProvider';

const COLUMNS =
  'id, patient_id, rule_id, severity, fired_at, acknowledged_at, ack_by_caregiver_id, context';

/** Loads alerts across every patient the signed-in caregiver is
 *  allocated to + keeps them live via Supabase Realtime. The bell badge
 *  reads the unacked subset; the popover renders the most recent N
 *  unacked alerts.
 *
 *  Implementation: a single React Query cache holds the rolling list;
 *  one Realtime channel subscribed with an IN-filter receives INSERT +
 *  UPDATE events for any allocated patient. F11's foundation migration
 *  adds `alerts` to the realtime publication.
 *
 *  Phase E updates:
 *    - item 44: INSERT handler dedupes by id before prepending so a
 *      race between subscribe and initial fetch doesn't double-count.
 *    - item 45: a second realtime channel watches the caller's
 *      `caregiver_patient` rows and refreshes the allocation set on
 *      INSERT/DELETE so re-allocations reflect without page reload.
 *    - exposes `isSuccess` so cue + live-region hooks can arm on the
 *      query landing rather than on the first non-empty payload (the
 *      latter swallowed criticals that landed inside the initial fetch).
 *
 *  Item 91: both channels now use subscribeWithRetry so the bell, cue,
 *  and /alerts feed re-subscribe after a network blip instead of going
 *  silent for the rest of the session.
 */
const ALLOCATED_KEY = (caregiverId: string | undefined) =>
  ['alerts', 'allocated', caregiverId ?? 'anon'] as const;

const ROW_LIMIT = 200;

export interface AllocatedAlertsResult {
  rows: AlertRow[];
  unackedCount: number;
  hasCritical: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
}

export function useAllocatedAlerts(): AllocatedAlertsResult {
  const { user } = useAuth();
  const caregiverId = user?.id;
  const qc = useQueryClient();

  const [allocatedPatients, setAllocatedPatients] = useState<string[]>([]);

  // Resolve allocated-patient ids first; the alerts subscription needs
  // an IN(...) filter. RLS scopes us to our own caregiver_patient rows.
  // A separate effect below subscribes to caregiver_patient changes and
  // refreshes this list when allocations move underfoot.
  async function refreshAllocations(): Promise<void> {
    if (!caregiverId) return;
    const { data } = await supabase
      .from('caregiver_patient')
      .select('patient_id')
      .eq('caregiver_id', caregiverId);
    if (!data) return;
    setAllocatedPatients((prev) => {
      const next = data.map((r: { patient_id: string }) => r.patient_id).sort();
      // Only update if the membership actually changed — stable identity
      // avoids re-subscribing the alerts channel on every render.
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }

  useEffect(() => {
    if (!caregiverId) return;
    let active = true;
    void refreshAllocations().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId]);

  // Item 45: react to caregiver_patient INSERT/DELETE on this caregiver
  // so the bell's allocation set + the alerts query both update without
  // a manual refresh. Phase B's tenancy refactor means allocation now
  // moves through the allocate_patient/unallocate_patient RPCs (admin)
  // and the same self-leave path.
  // Item 91: uses subscribeWithRetry so a transient WS drop doesn't
  // freeze the allocation set until page reload.
  useEffect(() => {
    if (!caregiverId) return;
    const unsubscribe = subscribeWithRetry({
      channelName: `caregiver_patient:caregiver:${caregiverId}`,
      postgresHandlers: [
        {
          event: '*',
          schema: 'public',
          table: 'caregiver_patient',
          filter: `caregiver_id=eq.${caregiverId}`,
          onMessage: () => {
            void refreshAllocations();
            // Keep dashboard + lookup caches consistent. Phase II.A
            // replaced the roster query key with the situation-overview
            // dashboard feed.
            qc.invalidateQueries({ queryKey: ['dashboard', 'situation-overview'] });
            qc.invalidateQueries({ queryKey: ['patients', 'lookup'] });
          },
        },
      ],
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId]);

  const query = useQuery({
    queryKey: ALLOCATED_KEY(caregiverId),
    enabled: !!caregiverId && allocatedPatients.length > 0,
    queryFn: async (): Promise<AlertRow[]> => {
      const { data, error } = await supabase
        .from('alerts')
        .select(COLUMNS)
        .in('patient_id', allocatedPatients)
        .order('fired_at', { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  // Single realtime channel filtered server-side via in() syntax.
  // Item 91: uses subscribeWithRetry so the bell, cue, and /alerts feed
  // re-subscribe after a network blip instead of going silent.
  useEffect(() => {
    if (!caregiverId || allocatedPatients.length === 0) return;
    const filter = `patient_id=in.(${allocatedPatients.join(',')})`;
    const unsubscribe = subscribeWithRetry({
      channelName: `alerts:caregiver:${caregiverId}`,
      postgresHandlers: [
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter,
          onMessage: (row) => {
            const alertRow = row as AlertRow;
            qc.setQueryData<AlertRow[]>(ALLOCATED_KEY(caregiverId), (prev) => {
              // Item 44: dedupe before prepending. The initial fetch may
              // already include this id (race between subscribe and select),
              // and bouncing a duplicate into the list breaks React keys
              // + double-counts unacked.
              if (prev?.some((r) => r.id === alertRow.id)) return prev;
              const next = [alertRow, ...(prev ?? [])];
              return next.slice(0, ROW_LIMIT);
            });
          },
        },
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alerts',
          filter,
          onMessage: (row) => {
            const alertRow = row as AlertRow;
            qc.setQueryData<AlertRow[]>(ALLOCATED_KEY(caregiverId), (prev) => {
              if (!prev) return prev;
              return prev.map((r) => (r.id === alertRow.id ? alertRow : r));
            });
          },
        },
      ],
    });
    return unsubscribe;
  }, [caregiverId, allocatedPatients, qc]);

  const rows = query.data ?? [];
  const unacked = rows.filter((r) => r.acknowledged_at == null);
  return {
    rows,
    unackedCount: unacked.length,
    hasCritical: unacked.some((r) => r.severity === 'critical'),
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
  };
}
