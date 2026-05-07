import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  AlertHistoryFilters,
  AlertHistoryRow,
  AlertRuleType,
  DateRange,
  PositionHistoryRow,
  VitalsHistoryRow,
} from '@/features/history/types';

// F13's history hooks. Server state per CROSS_CUTTING.md §7 — no
// realtime invalidation; React Query owns every fetch. The cache
// key includes the patient id and the (from, to) bounds so two tabs
// open on different ranges don't trample each other's caches.

const VITALS_COLUMNS = 'recorded_at, hr_bpm, spo2_pct, temp_c';
const POSITION_COLUMNS = 'recorded_at, mode, x_canvas, y_canvas, lat, lng, confidence';
const ALERT_COLUMNS =
  'id, patient_id, rule_id, severity, fired_at, acknowledged_at, ack_by_caregiver_id, context, alert_rules ( type )';

// Cap any single window so a misclick on "7d" with high-rate data
// can't lock the tab. 100k rows is well above realistic V1 volume
// (~86,400 rows for 24 h × 1 Hz vitals); the soft default in the UI
// is 6 h for vitals and 1 h for replay.
const MAX_ROWS = 100_000;

export function useVitalsHistory(patientId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: ['history', 'vitals', patientId, range.from, range.to] as const,
    enabled: !!patientId,
    staleTime: 30_000,
    queryFn: async (): Promise<VitalsHistoryRow[]> => {
      const { data, error } = await supabase
        .from('sensor_readings')
        .select(VITALS_COLUMNS)
        .eq('patient_id', patientId!)
        .gte('recorded_at', range.from)
        .lte('recorded_at', range.to)
        .order('recorded_at', { ascending: true })
        .limit(MAX_ROWS);
      if (error) throw error;
      return (data ?? []) as VitalsHistoryRow[];
    },
  });
}

export function usePositionHistory(patientId: string | undefined, range: DateRange) {
  return useQuery({
    queryKey: ['history', 'positions', patientId, range.from, range.to] as const,
    enabled: !!patientId,
    staleTime: 30_000,
    queryFn: async (): Promise<PositionHistoryRow[]> => {
      const { data, error } = await supabase
        .from('position_estimates')
        .select(POSITION_COLUMNS)
        .eq('patient_id', patientId!)
        .gte('recorded_at', range.from)
        .lte('recorded_at', range.to)
        .order('recorded_at', { ascending: true })
        .limit(MAX_ROWS);
      if (error) throw error;
      return (data ?? []) as PositionHistoryRow[];
    },
  });
}

// Supabase always returns embedded relations as an array, even for
// many-to-one joins like alerts.rule_id → alert_rules.id. We pick the
// first row (or null) to flatten back into AlertHistoryRow.
interface AlertJoinedRow {
  id: string;
  patient_id: string;
  rule_id: string | null;
  severity: AlertHistoryRow['severity'];
  fired_at: string;
  acknowledged_at: string | null;
  ack_by_caregiver_id: string | null;
  context: Record<string, unknown>;
  alert_rules: { type: AlertRuleType }[] | { type: AlertRuleType } | null;
}

export function useAlertHistory(
  patientId: string | undefined,
  range: DateRange,
  filters: AlertHistoryFilters,
) {
  return useQuery({
    queryKey: ['history', 'alerts', patientId, range.from, range.to] as const,
    enabled: !!patientId,
    staleTime: 30_000,
    queryFn: async (): Promise<AlertHistoryRow[]> => {
      const { data, error } = await supabase
        .from('alerts')
        .select(ALERT_COLUMNS)
        .eq('patient_id', patientId!)
        .gte('fired_at', range.from)
        .lte('fired_at', range.to)
        .order('fired_at', { ascending: false })
        .limit(MAX_ROWS);
      if (error) throw error;
      return ((data ?? []) as unknown as AlertJoinedRow[]).map((r) => {
        const rule = Array.isArray(r.alert_rules) ? r.alert_rules[0] : r.alert_rules;
        return {
          id: r.id,
          patient_id: r.patient_id,
          rule_id: r.rule_id,
          rule_type: rule?.type ?? null,
          severity: r.severity,
          fired_at: r.fired_at,
          acknowledged_at: r.acknowledged_at,
          ack_by_caregiver_id: r.ack_by_caregiver_id,
          context: r.context,
        };
      });
    },
    // Filters are applied client-side via filterAlerts() so toggling a
    // chip doesn't refetch — the date range is the only server-side
    // predicate per the F13 spec (Risks: alert filter combinatorics).
    select: (rows) => rows,
  });
}

// V1 surfaces four rule-type chips (zone/vitals/fall/inactivity);
// `repetitive_movement` is a V2 deferral with no chip. "No rule-type
// filter active" therefore means all four V1 types are selected.
const V1_RULE_TYPES_COUNT = 4;

export function filterAlerts(
  rows: AlertHistoryRow[],
  filters: AlertHistoryFilters,
): AlertHistoryRow[] {
  const wideOpenRuleTypes = filters.ruleTypes.size >= V1_RULE_TYPES_COUNT;
  return rows.filter((row) => {
    if (!filters.severities.has(row.severity)) return false;
    // Null rule_type ⇒ orphaned alert (rule deleted via on-delete-set-null).
    // Show only when no rule-type filter is active.
    if (row.rule_type == null) return wideOpenRuleTypes;
    if (!filters.ruleTypes.has(row.rule_type)) return false;
    return true;
  });
}
