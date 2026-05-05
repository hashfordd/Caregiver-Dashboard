import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { BeaconRow, UpdateBeaconPositionInput, UpsertBeaconInput } from './types';

const BEACON_COLUMNS =
  'id, patient_id, floor_plan_id, mac_address, label, x_canvas, y_canvas, tx_power, rssi_at_1m, created_at';

const beaconsKey = (patientId: string | undefined) => ['beacons', patientId] as const;

export function useBeacons(patientId: string | undefined) {
  return useQuery({
    queryKey: beaconsKey(patientId),
    enabled: !!patientId,
    queryFn: async (): Promise<BeaconRow[]> => {
      const { data, error } = await supabase
        .from('beacons')
        .select(BEACON_COLUMNS)
        .eq('patient_id', patientId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data as BeaconRow[]) ?? [];
    },
  });
}

export function useUpsertBeacon(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertBeaconInput): Promise<BeaconRow> => {
      const { data, error } = await supabase
        .from('beacons')
        .insert({
          patient_id: input.patient_id,
          floor_plan_id: input.floor_plan_id,
          mac_address: input.mac_address,
          label: input.label,
        })
        .select(BEACON_COLUMNS)
        .single();
      if (error) throw error;
      return data as BeaconRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: beaconsKey(patientId) }),
  });
}

export function useUpdateBeaconPosition(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBeaconPositionInput): Promise<BeaconRow> => {
      const { data, error } = await supabase
        .from('beacons')
        .update({ x_canvas: input.x_canvas, y_canvas: input.y_canvas })
        .eq('id', input.id)
        .select(BEACON_COLUMNS)
        .single();
      if (error) throw error;
      return data as BeaconRow;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: beaconsKey(patientId) }),
  });
}

export function useDeleteBeacon(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('beacons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: beaconsKey(patientId) }),
  });
}
