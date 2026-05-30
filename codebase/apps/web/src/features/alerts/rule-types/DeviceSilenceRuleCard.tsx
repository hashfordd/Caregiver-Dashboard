import { useEffect, useState } from 'react';
import type { AlertSeverity, DeviceSilenceParams, DeviceSilenceRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { NumberField } from '../inputs/NumberField';
import { RuleCardShell } from './RuleCardShell';

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
      <NumberField
        label="Alert when the wearable goes quiet for this long"
        description="Catches a flat battery, a removed band, or lost connectivity — the device simply stopped reporting."
        unit="min"
        min={1}
        max={1440}
        value={params.silence_minutes}
        onChange={(v) => setParams((p) => ({ ...p, silence_minutes: v ?? p.silence_minutes }))}
        presets={[
          { label: '5 min', value: 5 },
          { label: '15 min', value: 15 },
          { label: '30 min', value: 30 },
          { label: '1 hr', value: 60 },
        ]}
        invalid={!validMinutes}
      />
    </RuleCardShell>
  );
}
