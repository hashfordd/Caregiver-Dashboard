// Thin compositing hook: ties a door/window room_connector to a paired
// door_proximity alert_rule so each connector always has exactly one rule.
//
// CREATE connector → INSERT rule (door=critical / window=warning,
//   radius_m=1.0, dwell_seconds=3, shape='rectangle').
// DELETE connector → DELETE paired rule (matched by params->>'connector_id').
// UPDATE radius → UPDATE rule params.radius_m.
//
// Errors on either side are surfaced via toast (inherited from the
// underlying useUpsertAlertRule / useDeleteAlertRule mutations).  We do
// not leave orphans on failure because:
//   - create: we try the rule AFTER the connector succeeds; a rule
//     failure leaves a connector without a rule, which is annoying but
//     not data-corrupt.  The user can recreate via Alerts settings.
//   - delete: we try the rule BEFORE the connector; if the rule delete
//     fails we abort (returning the error) so the connector stays.
//   Both are best-effort at the UI layer — the rules engine silently
//   skips rules whose connector_id no longer exists anyway.

import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useUpsertAlertRule, useDeleteAlertRule } from '@/features/alerts/useAlertRules';
import { useUpsertRoomConnector, useDeleteRoomConnector } from '@/features/floor-plan/roomQueries';
import type { ConnectorKind, RoomConnectorRow, UpsertRoomConnectorInput } from './roomTypes';

const DEFAULT_RADIUS_M = 1.0;
const DEFAULT_DWELL_SECONDS = 3;
const DEFAULT_COOLDOWN_SECONDS = 300;

function severityForKind(kind: ConnectorKind): 'critical' | 'warn' {
  return kind === 'door' ? 'critical' : 'warn';
}

/** Find the alert_rule paired to a connector (params->>'connector_id' match). */
async function findPairedRule(
  patientId: string,
  connectorId: string,
): Promise<{ id: string; severity: string } | null> {
  const { data, error } = await supabase
    .from('alert_rules')
    .select('id, severity')
    .eq('patient_id', patientId)
    .eq('type', 'door_proximity')
    .eq('params->>connector_id', connectorId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { id: string; severity: string } | null) ?? null;
}

interface UseConnectorProximityRuleOptions {
  patientId: string;
}

/**
 * Returns three async helpers that wrap the connector + rule lifecycle:
 *  - createConnectorWithRule: upsert connector then provision a rule.
 *  - deleteConnectorWithRule: delete rule then delete connector.
 *  - updateConnectorRadius: update rule's radius_m for a saved connector.
 */
export function useConnectorProximityRule({ patientId }: UseConnectorProximityRuleOptions) {
  const upsertConnector = useUpsertRoomConnector();
  const deleteConnector = useDeleteRoomConnector();
  const upsertRule = useUpsertAlertRule(patientId);
  const deleteRule = useDeleteAlertRule(patientId);

  async function createConnectorWithRule(
    input: UpsertRoomConnectorInput,
  ): Promise<RoomConnectorRow> {
    const connector = await upsertConnector.mutateAsync(input);

    // Only provision rules for door/window — openings are passive.
    if (connector.kind === 'door' || connector.kind === 'window') {
      try {
        await upsertRule.mutateAsync({
          patient_id: patientId,
          type: 'door_proximity',
          severity: severityForKind(connector.kind),
          enabled: true,
          params: {
            connector_id: connector.id,
            radius_m: DEFAULT_RADIUS_M,
            dwell_seconds: DEFAULT_DWELL_SECONDS,
            cooldown_seconds: DEFAULT_COOLDOWN_SECONDS,
            shape: 'rectangle',
          },
        });
      } catch {
        // Rule creation failed — the connector exists.  Toast is handled
        // inside useUpsertAlertRule's onError; log here for context.
        console.warn('door/window connector created but proximity rule failed to provision');
      }
    }

    return connector;
  }

  async function deleteConnectorWithRule(input: {
    id: string;
    floor_plan_id: string;
  }): Promise<void> {
    // Find and delete the paired rule first so we don't orphan it.
    const existing = await findPairedRule(patientId, input.id);
    if (existing) {
      try {
        await deleteRule.mutateAsync(existing.id);
      } catch (err) {
        toast.error('Could not delete proximity rule', {
          description: (err as Error).message ?? 'Rule delete failed — connector was not deleted.',
        });
        throw err; // abort — keep the connector so the rule reference is intact
      }
    }
    await deleteConnector.mutateAsync(input);
  }

  async function updateConnectorRadius(connectorId: string, radiusM: number): Promise<void> {
    const existing = await findPairedRule(patientId, connectorId);
    if (!existing) return;

    await upsertRule.mutateAsync({
      id: existing.id,
      patient_id: patientId,
      type: 'door_proximity',
      severity: (existing.severity as 'critical' | 'warn' | 'info') ?? 'warn',
      enabled: true,
      params: {
        connector_id: connectorId,
        radius_m: radiusM,
        dwell_seconds: DEFAULT_DWELL_SECONDS,
        cooldown_seconds: DEFAULT_COOLDOWN_SECONDS,
        shape: 'rectangle',
      },
    });
  }

  return {
    createConnectorWithRule,
    deleteConnectorWithRule,
    updateConnectorRadius,
    upsertConnectorPending: upsertConnector.isPending,
    deleteConnectorPending: deleteConnector.isPending,
  };
}
