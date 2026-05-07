import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isClosedPolygon,
  isSimplePolygon,
  OutdoorZoneParams,
  type GeofencePolygon,
  type OutdoorZoneParams as OutdoorZoneParamsT,
} from '@alzcare/shared/rules';
import { supabase } from '@/lib/supabase';

/** F9 surface: read/write the patient's single outdoor geofence rule.
 *
 *  Phase C: zone rules now discriminate on `params.space`. The outdoor
 *  branch carries `{ space: 'outdoor', geofence, direction, dwell_seconds }`
 *  and is interchangeable with the indoor canvas branch at the row
 *  level — both write `type='zone'` rows. The fetch here filters by
 *  shape (validates `OutdoorZoneParams`) so the F9 UI only sees outdoor
 *  geofences. */

export interface OutdoorZoneRuleRow {
  id: string;
  patient_id: string;
  type: 'zone';
  params: OutdoorZoneParamsT;
  severity: 'info' | 'warn' | 'critical';
  enabled: boolean;
}

export function useGeofenceRule(patientId: string) {
  return useQuery({
    queryKey: ['alert_rules', 'zone', 'outdoor', patientId],
    queryFn: () => fetchOutdoorZoneRule(patientId),
  });
}

async function fetchOutdoorZoneRule(patientId: string): Promise<OutdoorZoneRuleRow | null> {
  const { data, error } = await supabase
    .from('alert_rules')
    .select('id, patient_id, type, params, severity, enabled')
    .eq('patient_id', patientId)
    .eq('type', 'zone')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    id: string;
    patient_id: string;
    type: 'zone';
    params: unknown;
    severity: OutdoorZoneRuleRow['severity'];
    enabled: boolean;
  }>) {
    const parsed = OutdoorZoneParams.safeParse(row.params);
    if (parsed.success) return { ...row, params: parsed.data };
  }
  return null;
}

export interface UpsertGeofenceInput {
  patientId: string;
  /** Existing rule id when editing; omit when creating. */
  ruleId?: string;
  polygon: GeofencePolygon;
  direction: 'enter' | 'exit';
  /** Defaults to 0 (immediate). */
  dwell_seconds?: number;
}

export function useUpsertGeofence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      ruleId,
      polygon,
      direction,
      dwell_seconds,
    }: UpsertGeofenceInput) => {
      if (!isClosedPolygon(polygon)) {
        throw new Error('Polygon must have ≥ 3 vertices and be closed.');
      }
      if (!isSimplePolygon(polygon)) {
        throw new Error('Polygon must not self-intersect.');
      }
      const params: OutdoorZoneParamsT = {
        space: 'outdoor',
        geofence: polygon,
        direction,
        dwell_seconds: dwell_seconds ?? 0,
      };
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
      qc.invalidateQueries({ queryKey: ['alert_rules', 'zone', 'outdoor', vars.patientId] });
      qc.invalidateQueries({ queryKey: ['alert_rules', 'patient', vars.patientId] });
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
      qc.invalidateQueries({ queryKey: ['alert_rules', 'zone', 'outdoor', data.patientId] });
      qc.invalidateQueries({ queryKey: ['alert_rules', 'patient', data.patientId] });
    },
  });
}
