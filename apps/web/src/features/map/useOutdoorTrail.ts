import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { usePatientStreamContext } from '@/features/patients/PatientStreamContext';
import { useOutdoorTrailStore } from '@/lib/stores/outdoorTrailStore';
import type { PositionEstimateRow } from '@/lib/usePatientStream';

const TRAIL_WINDOW_MS = 30 * 60 * 1000;

/** Fetches the last 30 min of outdoor position estimates from the DB and
 *  hydrates the Zustand trail. Subscribes to the realtime stream and
 *  appends each new outdoor estimate. Returns the live trail (sorted
 *  ascending by recorded_at, capped to the 30-min window).
 *
 *  React Query handles the initial fetch (cache, dedupe, error). Zustand
 *  owns the live appends (CROSS_CUTTING §7). React Query intentionally
 *  doesn't refetch on every realtime arrival — that would defeat the
 *  point. */
export function useOutdoorTrail(): {
  trail: PositionEstimateRow[];
  isLoading: boolean;
  isError: boolean;
} {
  const { patientId, onPositionEstimate } = usePatientStreamContext();
  const trail = useOutdoorTrailStore((s) => s.byPatient[patientId] ?? []);

  const initialQuery = useQuery({
    queryKey: ['position_estimates', 'outdoor-trail', patientId],
    queryFn: () => fetchInitialTrail(patientId),
  });

  // Hydrate the store once the initial fetch lands.
  useEffect(() => {
    if (initialQuery.data) {
      useOutdoorTrailStore.getState().hydrate(patientId, initialQuery.data);
    }
  }, [patientId, initialQuery.data]);

  // Append realtime outdoor estimates; ignore indoor. Item 152: refcount
  // the store via acquire/release so future second consumers don't lose
  // the trail when the first unmounts. The store's release() clears the
  // trail only when the count hits zero.
  useEffect(() => {
    useOutdoorTrailStore.getState().acquire(patientId);
    const unsubscribe = onPositionEstimate((row) => {
      if (row.mode !== 'outdoor') return;
      if (row.lat == null || row.lng == null) return;
      useOutdoorTrailStore.getState().push(patientId, row);
    });
    return () => {
      unsubscribe();
      useOutdoorTrailStore.getState().release(patientId);
    };
  }, [patientId, onPositionEstimate]);

  return {
    trail,
    isLoading: initialQuery.isLoading,
    isError: initialQuery.isError,
  };
}

async function fetchInitialTrail(patientId: string): Promise<PositionEstimateRow[]> {
  const since = new Date(Date.now() - TRAIL_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('position_estimates')
    .select(
      'id, patient_id, recorded_at, mode, x_canvas, y_canvas, lat, lng, confidence, created_at',
    )
    .eq('patient_id', patientId)
    .eq('mode', 'outdoor')
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PositionEstimateRow[];
}
