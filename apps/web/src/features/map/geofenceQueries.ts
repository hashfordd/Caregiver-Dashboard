import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GeofenceParams,
  isClosedPolygon,
  isSimplePolygon,
  type GeofencePolygon,
} from '@alzcare/shared/rules';
import { supabase } from '@/lib/supabase';

/** F9 surface: read/write the patient's single outdoor zone rule. The
 *  schema allows multiple zone rules per patient (F11 will use that for
 *  multiple geofences) but F9's UI is scoped to one — the most recent
 *  enabled outdoor polygon. */

export interface ZoneRuleRow {
  id: string;
  patient_id: string;
  type: 'zone';
  params: GeofenceParams;
  severity: 'info' | 'warn' | 'critical';
  enabled: boolean;
}

export function useGeofenceRule(patientId: string) {
  return useQuery({
    queryKey: ['alert_rules', 'zone', patientId],
    queryFn: () => fetchOutdoorZoneRule(patientId),
  });
}

async function fetchOutdoorZoneRule(patientId: string): Promise<ZoneRuleRow | null> {
  const { data, error } = await supabase
    .from('alert_rules')
    .select('id, patient_id, type, params, severity, enabled')
    .eq('patient_id', patientId)
    .eq('type', 'zone')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as
    | {
        id: string;
        patient_id: string;
        type: 'zone';
        params: unknown;
        severity: ZoneRuleRow['severity'];
        enabled: boolean;
      }
    | undefined;
  if (!row) return null;
  const parsed = GeofenceParams.safeParse(row.params);
  if (!parsed.success) return null; // Row exists but isn't an outdoor geofence shape — ignore.
  return { ...row, params: parsed.data };
}

export interface UpsertGeofenceInput {
  patientId: string;
  /** Existing rule id when editing; omit when creating. */
  ruleId?: string;
  polygon: GeofencePolygon;
  mode: GeofenceParams['mode'];
}

export function useUpsertGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, ruleId, polygon, mode }: UpsertGeofenceInput) => {
      if (!isClosedPolygon(polygon)) {
        throw new Error('Polygon must have ≥ 3 vertices and be closed.');
      }
      if (!isSimplePolygon(polygon)) {
        throw new Error('Polygon must not self-intersect.');
      }
      const params: GeofenceParams = { geofence: polygon, mode };
      if (ruleId) {
        const { data, error } = await supabase
          .from('alert_rules')
          .update({ params, enabled: true })
          .eq('id', ruleId)
          .select('id')
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('alert_rules')
        .insert({
          patient_id: patientId,
          type: 'zone',
          severity: 'warn',
          enabled: true,
          params,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['alert_rules', 'zone', vars.patientId] });
    },
  });
}

export function useDeleteGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, ruleId }: { patientId: string; ruleId: string }) => {
      const { error } = await supabase.from('alert_rules').delete().eq('id', ruleId);
      if (error) throw error;
      return { patientId };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['alert_rules', 'zone', data.patientId] });
    },
  });
}
