import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FloorPlanRow, UpsertFloorPlanInput } from './types';

const FLOOR_PLAN_COLUMNS =
  'id, patient_id, name, canvas_json, scale_meters_per_pixel, created_at, updated_at, is_active';

/** Phase F item 49: scope reads to the active row.
 *
 *  The schema now allows multiple inactive plans per patient (V2 path
 *  for "swap to a new floor plan version while keeping the old one for
 *  replay"). The UNIQUE partial index `floor_plans_one_active_per_patient`
 *  guarantees at most one row with `is_active = true` per patient_id.
 *  V1's editor reads + writes the active row only. */
export function useFloorPlan(patientId: string | undefined) {
  return useQuery({
    queryKey: ['floor-plan', 'active', patientId],
    enabled: !!patientId,
    queryFn: async (): Promise<FloorPlanRow | null> => {
      const { data, error } = await supabase
        .from('floor_plans')
        .select(FLOOR_PLAN_COLUMNS)
        .eq('patient_id', patientId!)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return (data as FloorPlanRow | null) ?? null;
    },
  });
}

/** Find-active-or-insert pattern. With the partial unique index in
 *  place, a naive blind INSERT would fail when a tab races a save
 *  against another tab; we eat that complexity here so the editor
 *  doesn't need to know about it. */
export function useUpsertFloorPlan(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertFloorPlanInput): Promise<FloorPlanRow> => {
      const payload = {
        canvas_json: input.canvas_json,
        scale_meters_per_pixel: input.scale_meters_per_pixel,
        name: input.name ?? 'Floor plan',
      };

      // Resolve target row id deterministically: explicit input.id wins,
      // else the patient's active row. If neither exists, INSERT fresh.
      let targetId: string | null = input.id ?? null;
      if (!targetId) {
        const { data: existing } = await supabase
          .from('floor_plans')
          .select('id')
          .eq('patient_id', input.patient_id)
          .eq('is_active', true)
          .maybeSingle();
        targetId = (existing as { id: string } | null)?.id ?? null;
      }

      if (targetId) {
        const { data, error } = await supabase
          .from('floor_plans')
          .update(payload)
          .eq('id', targetId)
          .select(FLOOR_PLAN_COLUMNS)
          .single();
        if (error) throw error;
        return data as FloorPlanRow;
      }

      const { data, error } = await supabase
        .from('floor_plans')
        .insert({ ...payload, patient_id: input.patient_id, is_active: true })
        .select(FLOOR_PLAN_COLUMNS)
        .single();
      if (error) throw error;
      return data as FloorPlanRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['floor-plan', 'active', patientId] }),
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
