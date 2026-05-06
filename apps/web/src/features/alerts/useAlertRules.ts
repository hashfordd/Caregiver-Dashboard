import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertRuleParams,
  type AlertRule,
  type AlertSeverity,
  type AlertRuleType,
} from '@alzcare/shared';
import { supabase } from '@/lib/supabase';

const COLUMNS = 'id, patient_id, type, params, severity, enabled, created_at, updated_at';
const KEY = (patientId: string) => ['alert_rules', patientId] as const;

export function useAlertRules(patientId: string | undefined) {
  return useQuery({
    queryKey: KEY(patientId ?? 'unknown'),
    enabled: !!patientId,
    queryFn: async (): Promise<AlertRule[]> => {
      const { data, error } = await supabase
        .from('alert_rules')
        .select(COLUMNS)
        .eq('patient_id', patientId!)
        .order('type', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        patient_id: string;
        type: string;
        params: unknown;
        severity: AlertSeverity;
        enabled: boolean;
        created_at: string;
        updated_at: string;
      }>;
      return rows
        .map((row) => {
          const parsed = AlertRuleParams.safeParse({ type: row.type, params: row.params });
          if (!parsed.success) return null;
          return {
            id: row.id,
            patient_id: row.patient_id,
            severity: row.severity,
            enabled: row.enabled,
            created_at: row.created_at,
            updated_at: row.updated_at,
            type: parsed.data.type,
            params: parsed.data.params,
          } as AlertRule;
        })
        .filter((r): r is AlertRule => r != null);
    },
  });
}

export interface UpsertAlertRuleInput {
  /** When omitted, an INSERT is performed; when present, an UPDATE. */
  id?: string;
  patient_id: string;
  type: AlertRuleType;
  params: unknown;
  severity: AlertSeverity;
  enabled: boolean;
}

export function useUpsertAlertRule(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertAlertRuleInput): Promise<AlertRule> => {
      // Re-validate the params shape against the discriminated schema so
      // we never persist a JSONB blob that the engine would later reject.
      const parsed = AlertRuleParams.parse({ type: input.type, params: input.params });
      const row = {
        patient_id: input.patient_id,
        type: parsed.type,
        params: parsed.params as Record<string, unknown>,
        severity: input.severity,
        enabled: input.enabled,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('alert_rules')
          .update(row)
          .eq('id', input.id)
          .select(COLUMNS)
          .single();
        if (error) throw error;
        return data as unknown as AlertRule;
      }
      const { data, error } = await supabase
        .from('alert_rules')
        .insert(row)
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return data as unknown as AlertRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(patientId) }),
  });
}

export function useDeleteAlertRule(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from('alert_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY(patientId) }),
  });
}
