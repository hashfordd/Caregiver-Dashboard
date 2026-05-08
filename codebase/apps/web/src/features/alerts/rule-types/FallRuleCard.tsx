import { useEffect, useState } from 'react';
import type { AlertSeverity, FallParams, FallRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: FallRule | null;
}

/** Phase C item 46: the previous version captured `params` from the
 *  rule prop on first render and never re-synced when the rule arrived
 *  later via the alert_rules query. As a result, saving a fall rule
 *  before the query resolved would persist `params: {}` and clobber any
 *  stored values. Both `setParams` and a params-reset in the useEffect
 *  fix that. */
export function FallRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);
  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'critical');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [params, setParams] = useState<FallParams>(rule?.params ?? {});

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setParams(rule.params);
    } else {
      setDraftSeverity('critical');
      setDraftEnabled(true);
      setParams({});
    }
  }, [rule]);

  const dirty =
    rule == null ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    JSON.stringify(rule.params) !== JSON.stringify(params);

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
