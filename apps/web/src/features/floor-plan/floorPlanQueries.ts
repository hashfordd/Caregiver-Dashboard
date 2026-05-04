import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FloorPlanRow, UpsertFloorPlanInput } from './types';

const FLOOR_PLAN_COLUMNS = 'id, patient_id, name, canvas_json, scale_meters_per_pixel, created_at';

export function useFloorPlan(patientId: string | undefined) {
  return useQuery({
    queryKey: ['floor-plan', patientId],
    enabled: !!patientId,
    queryFn: async (): Promise<FloorPlanRow | null> => {
      const { data, error } = await supabase
        .from('floor_plans')
        .select(FLOOR_PLAN_COLUMNS)
        .eq('patient_id', patientId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as FloorPlanRow | null) ?? null;
    },
  });
}

export function useUpsertFloorPlan(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertFloorPlanInput): Promise<FloorPlanRow> => {
      const payload = {
        canvas_json: input.canvas_json,
        scale_meters_per_pixel: input.scale_meters_per_pixel,
        name: input.name ?? 'Floor plan',
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('floor_plans')
          .update(payload)
          .eq('id', input.id)
          .select(FLOOR_PLAN_COLUMNS)
          .single();
        if (error) throw error;
        return data as FloorPlanRow;
      }
      const { data, error } = await supabase
        .from('floor_plans')
        .insert({ ...payload, patient_id: input.patient_id })
        .select(FLOOR_PLAN_COLUMNS)
        .single();
      if (error) throw error;
      return data as FloorPlanRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['floor-plan', patientId] }),
  });
}

export function useCalibrationCount(floorPlanId: string | undefined) {
  return useQuery({
    queryKey: ['calibration-count', floorPlanId],
    enabled: !!floorPlanId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('calibration_points')
        .select('*', { count: 'exact', head: true })
        .eq('floor_plan_id', floorPlanId!);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
