import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CalibrationPointRow, CaptureCalibrationPointInput } from './types';

const CALIBRATION_COLUMNS =
  'id, floor_plan_id, x_canvas, y_canvas, ble_signature, wifi_signature, captured_at';

const calibrationKey = (floorPlanId: string | undefined | null) =>
  ['calibrationPoints', floorPlanId] as const;

export function useCalibrationPoints(floorPlanId: string | undefined | null) {
  return useQuery({
    queryKey: calibrationKey(floorPlanId),
    enabled: !!floorPlanId,
    queryFn: async (): Promise<CalibrationPointRow[]> => {
      const { data, error } = await supabase
        .from('calibration_points')
        .select(CALIBRATION_COLUMNS)
        .eq('floor_plan_id', floorPlanId!)
        .order('captured_at', { ascending: true });
      if (error) throw error;
      return (data as CalibrationPointRow[]) ?? [];
    },
  });
}

export function useCaptureCalibrationPoint(floorPlanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CaptureCalibrationPointInput): Promise<CalibrationPointRow> => {
      const { data, error } = await supabase
        .from('calibration_points')
        .insert({
          floor_plan_id: input.floor_plan_id,
          x_canvas: input.x_canvas,
          y_canvas: input.y_canvas,
          ble_signature: input.ble_signature,
          wifi_signature: input.wifi_signature,
        })
        .select(CALIBRATION_COLUMNS)
        .single();
      if (error) throw error;
      return data as CalibrationPointRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: calibrationKey(floorPlanId) }),
  });
}

export function useDeleteCalibrationPoint(floorPlanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('calibration_points').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: calibrationKey(floorPlanId) }),
  });
}
