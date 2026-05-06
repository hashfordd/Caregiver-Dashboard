import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AlertRow } from '@alzcare/shared';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';

const COLUMNS =
  'id, patient_id, rule_id, severity, fired_at, acknowledged_at, ack_by_caregiver_id, context';

/** Loads alerts across every patient the signed-in caregiver is
 *  allocated to + keeps them live via Supabase Realtime. The bell badge
 *  reads the unacked subset; the popover renders the most recent N
 *  unacked alerts.
 *
 *  Implementation: a single React Query cache holds the rolling list;
 *  a single Realtime channel subscribed with an IN-filter receives
 *  INSERT + UPDATE events for any allocated patient. F11's foundation
 *  migration already adds `alerts` to the realtime publication. */
const ALLOCATED_KEY = (caregiverId: string | undefined) =>
  ['alerts', 'allocated', caregiverId ?? 'anon'] as const;

export interface AllocatedAlertsResult {
  rows: AlertRow[];
  unackedCount: number;
  hasCritical: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useAllocatedAlerts(): AllocatedAlertsResult {
  const { user } = useAuth();
  const caregiverId = user?.id;
  const qc = useQueryClient();

  const [allocatedPatients, setAllocatedPatients] = useState<string[]>([]);

  // Resolve allocated-patient ids first; the alerts subscription needs
  // an IN(...) filter. The query is scoped via RLS — we only ever see
  // our own caregiver_patient rows.
  useEffect(() => {
    if (!caregiverId) return;
    let active = true;
    void supabase
      .from('caregiver_patient')
      .select('patient_id')
      .eq('caregiver_id', caregiverId)
      .then(({ data }) => {
        if (!active || !data) return;
        setAllocatedPatients(data.map((r: { patient_id: string }) => r.patient_id));
      });
    return () => {
      active = false;
    };
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
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  // Single realtime channel filtered server-side via in() syntax.
  useEffect(() => {
    if (!caregiverId || allocatedPatients.length === 0) return;
    const filter = `patient_id=in.(${allocatedPatients.join(',')})`;
    const channel: RealtimeChannel = supabase
      .channel(`alerts:caregiver:${caregiverId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts', filter },
        (payload) => {
          const row = payload.new as AlertRow;
          qc.setQueryData<AlertRow[]>(ALLOCATED_KEY(caregiverId), (prev) => {
            const next = [row, ...(prev ?? [])];
            // Keep at most 200 — same as the initial fetch cap.
            return next.slice(0, 200);
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'alerts', filter },
        (payload) => {
          const row = payload.new as AlertRow;
          qc.setQueryData<AlertRow[]>(ALLOCATED_KEY(caregiverId), (prev) => {
            if (!prev) return prev;
            return prev.map((r) => (r.id === row.id ? row : r));
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [caregiverId, allocatedPatients, qc]);

  const rows = query.data ?? [];
  const unacked = rows.filter((r) => r.acknowledged_at == null);
  return {
    rows,
    unackedCount: unacked.length,
    hasCritical: unacked.some((r) => r.severity === 'critical'),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
