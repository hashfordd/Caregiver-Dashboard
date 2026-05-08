import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { subscribeWithRetry } from '@/lib/subscribeWithRetry';
import { useAuth } from '@/features/auth/AuthProvider';
import type { PatientSituation } from './types';

// PR-1.5 strategy:
//   1. TanStack baseline poll every POLL_INTERVAL_MS — covers fresh
//      caregiver allocations + alert-count drift + audit/edit surfaces
//      that don't have realtime fanout.
//   2. position_estimates INSERTs filtered by the set of allocated
//      patient ids → optimistic cache patch (no extra RPC). The patch
//      only overwrites when the incoming recorded_at beats the cached
//      last_position_at, which keeps out-of-order arrivals from
//      regressing the freshness clock.
//
// Open-alerts count + alert stream are owned by useAllocatedAlerts and
// already have their own realtime subscription; the dashboard composes
// the two hooks rather than duplicating the alerts subscription here.

const POLL_INTERVAL_MS = 5_000;
export const SITUATION_OVERVIEW_KEY = ['dashboard', 'situation-overview'] as const;

/** Subset of public.position_estimates columns delivered by the
 *  realtime publication. Mode is the enum, not a free string. */
interface PositionInsertPayload {
  patient_id: string;
  recorded_at: string;
  mode: 'indoor' | 'outdoor';
  x_canvas: number | null;
  y_canvas: number | null;
  lat: number | null;
  lng: number | null;
}

export function useSituationOverview() {
  const { user } = useAuth();
  const caregiverId = user?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: SITUATION_OVERVIEW_KEY,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<PatientSituation[]> => {
      const { data, error } = await supabase.rpc('get_situation_overview');
      if (error) throw error;
      return (data ?? []) as PatientSituation[];
    },
  });

  // String-stable list of allocated patient ids — the realtime IN
  // filter recomputes when the membership changes (allocate /
  // unallocate / new patient created), and is identity-stable across
  // re-renders that don't change the set.
  const filterKey = useMemo(() => {
    const ids = (query.data ?? []).map((r) => r.patient_id).sort();
    return ids.join(',');
  }, [query.data]);

  useEffect(() => {
    if (!caregiverId || !filterKey) return;
    const ids = filterKey.split(',');
    const filter = `patient_id=in.(${ids.join(',')})`;

    const unsubscribe = subscribeWithRetry<PositionInsertPayload>({
      channelName: `dashboard:positions:${caregiverId}`,
      postgresHandlers: [
        {
          event: 'INSERT',
          schema: 'public',
          table: 'position_estimates',
          filter,
          onMessage: (row) => {
            qc.setQueryData<PatientSituation[]>(SITUATION_OVERVIEW_KEY, (prev) => {
              if (!prev) return prev;
              return prev.map((r) => {
                if (r.patient_id !== row.patient_id) return r;
                // Drop out-of-order arrivals so the freshness dot
                // doesn't regress on a delayed packet.
                if (
                  r.last_position_at &&
                  new Date(r.last_position_at).getTime() >= new Date(row.recorded_at).getTime()
                ) {
                  return r;
                }
                return {
                  ...r,
                  last_position_at: row.recorded_at,
                  last_position_mode: row.mode,
                  last_position_x: row.x_canvas == null ? null : String(row.x_canvas),
                  last_position_y: row.y_canvas == null ? null : String(row.y_canvas),
                  last_position_lat: row.lat == null ? null : String(row.lat),
                  last_position_lng: row.lng == null ? null : String(row.lng),
                };
              });
            });
          },
        },
      ],
    });

    return unsubscribe;
  }, [caregiverId, filterKey, qc]);

  return query;
}
