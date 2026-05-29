import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  RoomConnectorRow,
  RoomRow,
  UpsertRoomConnectorInput,
  UpsertRoomInput,
} from './roomTypes';

const ROOM_COLUMNS =
  'id, patient_id, floor_plan_id, name, room_type, polygon_canvas, created_at, updated_at';
const CONNECTOR_COLUMNS =
  'id, patient_id, floor_plan_id, kind, start_x, start_y, end_x, end_y, room_a_id, room_b_id, label, created_at, updated_at';

// ─── rooms ────────────────────────────────────────────────────────────

export function useRooms(floorPlanId: string | undefined) {
  return useQuery({
    queryKey: ['rooms', floorPlanId],
    enabled: !!floorPlanId,
    queryFn: async (): Promise<RoomRow[]> => {
      const { data, error } = await supabase
        .from('rooms')
        .select(ROOM_COLUMNS)
        .eq('floor_plan_id', floorPlanId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data as RoomRow[] | null) ?? [];
    },
  });
}

export function useUpsertRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRoomInput): Promise<RoomRow> => {
      const payload = {
        patient_id: input.patient_id,
        floor_plan_id: input.floor_plan_id,
        name: input.name,
        room_type: input.room_type,
        polygon_canvas: input.polygon_canvas,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('rooms')
          .update(payload)
          .eq('id', input.id)
          .select(ROOM_COLUMNS)
          .single();
        if (error) throw error;
        return data as RoomRow;
      }
      const { data, error } = await supabase
        .from('rooms')
        .insert(payload)
        .select(ROOM_COLUMNS)
        .single();
      if (error) throw error;
      return data as RoomRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['rooms', row.floor_plan_id] });
    },
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; floor_plan_id: string }) => {
      const { error } = await supabase.from('rooms').delete().eq('id', input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      qc.invalidateQueries({ queryKey: ['rooms', input.floor_plan_id] });
      // Connectors referencing this room had their FK set to null by the
      // schema; refresh so the panel reflects that.
      qc.invalidateQueries({ queryKey: ['room-connectors', input.floor_plan_id] });
    },
  });
}

// ─── connectors ───────────────────────────────────────────────────────

export function useRoomConnectors(floorPlanId: string | undefined) {
  return useQuery({
    queryKey: ['room-connectors', floorPlanId],
    enabled: !!floorPlanId,
    queryFn: async (): Promise<RoomConnectorRow[]> => {
      const { data, error } = await supabase
        .from('room_connectors')
        .select(CONNECTOR_COLUMNS)
        .eq('floor_plan_id', floorPlanId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data as RoomConnectorRow[] | null) ?? [];
    },
  });
}

export function useUpsertRoomConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRoomConnectorInput): Promise<RoomConnectorRow> => {
      const payload = {
        patient_id: input.patient_id,
        floor_plan_id: input.floor_plan_id,
        kind: input.kind,
        start_x: input.start_x,
        start_y: input.start_y,
        end_x: input.end_x,
        end_y: input.end_y,
        room_a_id: input.room_a_id ?? null,
        room_b_id: input.room_b_id ?? null,
        label: input.label ?? null,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('room_connectors')
          .update(payload)
          .eq('id', input.id)
          .select(CONNECTOR_COLUMNS)
          .single();
        if (error) throw error;
        return data as RoomConnectorRow;
      }
      const { data, error } = await supabase
        .from('room_connectors')
        .insert(payload)
        .select(CONNECTOR_COLUMNS)
        .single();
      if (error) throw error;
      return data as RoomConnectorRow;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['room-connectors', row.floor_plan_id] });
    },
  });
}

export function useDeleteRoomConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; floor_plan_id: string }) => {
      const { error } = await supabase.from('room_connectors').delete().eq('id', input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      qc.invalidateQueries({ queryKey: ['room-connectors', input.floor_plan_id] });
    },
  });
}
