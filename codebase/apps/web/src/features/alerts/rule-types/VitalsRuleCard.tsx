import { useEffect, useState } from 'react';
import type { AlertSeverity, VitalsParams, VitalsRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: VitalsRule | null;
  /** Per-metric defaults for the "Add" path. */
  defaults: VitalsParams;
  defaultSeverity?: AlertSeverity;
  title: string;
}

export function VitalsRuleCard({
  patientId,
  rule,
  defaults,
  defaultSeverity = 'warn',
  title,
}: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);
  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(
    rule?.severity ?? defaultSeverity,
  );
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [params, setParams] = useState<VitalsParams>(rule?.params ?? defaults);

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setParams(rule.params);
    } else {
      setDraftSeverity(defaultSeverity);
      setDraftEnabled(true);
      setParams(defaults);
    }
  }, [rule, defaultSeverity, defaults]);

  const dirty =
    rule == null ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    JSON.stringify(rule.params) !== JSON.stringify(params);

  const validRange =
    (params.min == null || Number.isFinite(params.min)) &&
    (params.max == null || Number.isFinite(params.max)) &&
    (params.min == null || params.max == null || params.min < params.max);

  const previewRule: VitalsRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'vitals',
    params,
    created_at: rule?.created_at ?? new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return (
    <RuleCardShell
      title={title}
      type="vitals"
      severity={draftSeverity}
      enabled={draftEnabled}
      onSeverityChange={setDraftSeverity}
      onEnabledChange={setDraftEnabled}
      saveDisabled={!dirty || !validRange}
      saving={upsert.isPending}
      saveError={upsert.error ? (upsert.error as Error).message : null}
      onSave={() =>
        upsert.mutate({
          id: rule?.id,
          patient_id: patientId,
          type: 'vitals',
          params,
          severity: draftSeverity,
          enabled: draftEnabled,
        })
      }
      onDelete={rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <FieldLabel label="Metric">
        <select
          value={params.metric}
          onChange={(e) =>
            setParams((p) => ({ ...p, metric: e.target.value as VitalsParams['metric'] }))
          }
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="hr_bpm">Heart rate (bpm)</option>
          <option value="spo2_pct">SpO₂ (%)</option>
          <option value="temp_c">Temperature (°C)</option>
        </select>
      </FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Lower bound (inclusive)">
          <input
            type="number"
            value={params.min ?? ''}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value;
              setParams((p) => ({ ...p, min: v === '' ? null : Number(v) }));
            }}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </FieldLabel>
        <FieldLabel label="Upper bound (inclusive)">
          <input
            type="number"
            value={params.max ?? ''}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value;
              setParams((p) => ({ ...p, max: v === '' ? null : Number(v) }));
            }}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </FieldLabel>
      </div>
      {!validRange && (
        <p className="text-xs text-destructive">Lower bound must be less than upper bound.</p>
      )}
    </RuleCardShell>
  );
}
