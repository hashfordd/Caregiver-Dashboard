import { useEffect, useState } from 'react';
import type { AlertSeverity, DeviceSilenceParams, DeviceSilenceRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

// Item 131: device_silence — fires when the patient's wearable hasn't
// reported in N minutes. Distinct from inactivity ("patient not moving
// but device is reporting"). Mirrors InactivityRuleCard's surface.

interface Props {
  patientId: string;
  rule: DeviceSilenceRule | null;
}

const DEFAULTS: DeviceSilenceParams = {
  silence_minutes: 15,
};

export function DeviceSilenceRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);
  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'warn');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [params, setParams] = useState<DeviceSilenceParams>(rule?.params ?? DEFAULTS);

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setParams(rule.params);
    } else {
      setDraftSeverity('warn');
      setDraftEnabled(true);
      setParams(DEFAULTS);
    }
  }, [rule]);

  const validMinutes = Number.isFinite(params.silence_minutes) && params.silence_minutes > 0;
  const dirty =
    rule == null ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    JSON.stringify(rule.params) !== JSON.stringify(params);

  const previewRule: DeviceSilenceRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'device_silence',
    params,
    created_at: rule?.created_at ?? new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return (
    <RuleCardShell
      title="Device silence"
      type="device_silence"
      severity={draftSeverity}
      enabled={draftEnabled}
      onSeverityChange={setDraftSeverity}
      onEnabledChange={setDraftEnabled}
      saveDisabled={!dirty || !validMinutes}
      saving={upsert.isPending}
      saveError={upsert.error ? (upsert.error as Error).message : null}
      onSave={() =>
        upsert.mutate({
          id: rule?.id,
          patient_id: patientId,
          type: 'device_silence',
          params,
          severity: draftSeverity,
          enabled: draftEnabled,
        })
      }
      onDelete={rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <FieldLabel label="Trigger when the wearable hasn't reported for this many minutes">
        <input
          type="number"
          min={1}
          value={params.silence_minutes}
          onChange={(e) => setParams((p) => ({ ...p, silence_minutes: Number(e.target.value) }))}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        />
      </FieldLabel>
    </RuleCardShell>
  );
}
