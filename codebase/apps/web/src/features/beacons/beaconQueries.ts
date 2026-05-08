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

export interface UpdateBeaconCalibrationInput {
  id: string;
  rssi_at_1m: number;
  // Item 126: tx_power optional. The dialog no longer writes it (the
  // path-loss model only consumes rssi_at_1m, and the prior code
  // collapsed two distinct concepts by writing the same captured value
  // to both). Existing rows keep whatever was previously written; new
  // captures only update rssi_at_1m. Future calibration flows that
  // genuinely measure transmit power can supply this field.
  tx_power?: number;
}

/** Writes the F8 path-loss calibration columns back to a beacon. Driven
 *  by BeaconCalibrationDialog after a 5-s 1 m capture window. */
export function useUpdateBeaconCalibration(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBeaconCalibrationInput): Promise<BeaconRow> => {
      const payload: { rssi_at_1m: number; tx_power?: number } = {
        rssi_at_1m: input.rssi_at_1m,
      };
      if (input.tx_power !== undefined) payload.tx_power = input.tx_power;
      const { data, error } = await supabase
        .from('beacons')
        .update(payload)
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
