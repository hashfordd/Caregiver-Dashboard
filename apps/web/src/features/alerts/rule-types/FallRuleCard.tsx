import { useEffect, useState } from 'react';
import type { AlertSeverity, FallParams, FallRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: FallRule | null;
}

export function FallRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);
  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'critical');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [params] = useState<FallParams>(rule?.params ?? {});

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
    }
  }, [rule]);

  const dirty = rule == null || rule.severity !== draftSeverity || rule.enabled !== draftEnabled;

  const previewRule: FallRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'fall',
    params,
    created_at: rule?.created_at ?? new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return (
    <RuleCardShell
      title="Fall detection"
      type="fall"
      severity={draftSeverity}
      enabled={draftEnabled}
      onSeverityChange={setDraftSeverity}
      onEnabledChange={setDraftEnabled}
      saveDisabled={!dirty}
      saving={upsert.isPending}
      saveError={upsert.error ? (upsert.error as Error).message : null}
      onSave={() =>
        upsert.mutate({
          id: rule?.id,
          patient_id: patientId,
          type: 'fall',
          params,
          severity: draftSeverity,
          enabled: draftEnabled,
        })
      }
      onDelete={rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <p className="text-xs text-muted-foreground">
        Fires whenever the wearable publishes a <code>type=fall</code> event. No tunable parameters
        in V1 — severity controls how loudly the alert surfaces in the feed.
      </p>
    </RuleCardShell>
  );
}
