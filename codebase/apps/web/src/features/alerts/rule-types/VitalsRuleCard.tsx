import { useEffect, useState } from 'react';
import type { AlertSeverity, VitalsParams, VitalsRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { NumberField } from '../inputs/NumberField';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

const METRIC_UNIT: Record<VitalsParams['metric'], string> = {
  hr_bpm: 'bpm',
  spo2_pct: '%',
  temp_c: '°C',
};
const METRIC_RANGE: Record<VitalsParams['metric'], { min: number; max: number }> = {
  hr_bpm: { min: 30, max: 220 },
  spo2_pct: { min: 50, max: 100 },
  temp_c: { min: 30, max: 45 },
};

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
          {/* HR is the only metric the wearable reports. SpO₂/temp appear
              only for legacy rules already set on those metrics, so they
              stay editable/deletable without being offered for new rules. */}
          <option value="hr_bpm">Heart rate (bpm)</option>
          {params.metric === 'spo2_pct' && <option value="spo2_pct">SpO₂ (%)</option>}
          {params.metric === 'temp_c' && <option value="temp_c">Temperature (°C)</option>}
        </select>
      </FieldLabel>
      <p className="text-xs text-muted-foreground">
        Alerts when a reading leaves the safe range. Leave a bound blank for a one-sided limit (e.g.
        only a low-heart-rate alarm).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="Lower bound (inclusive)"
          unit={METRIC_UNIT[params.metric]}
          allowEmpty
          min={METRIC_RANGE[params.metric].min}
          max={METRIC_RANGE[params.metric].max}
          step={params.metric === 'temp_c' ? 0.1 : 1}
          placeholder="No low limit"
          value={params.min}
          onChange={(v) => setParams((p) => ({ ...p, min: v }))}
          invalid={!validRange}
        />
        <NumberField
          label="Upper bound (inclusive)"
          unit={METRIC_UNIT[params.metric]}
          allowEmpty
          min={METRIC_RANGE[params.metric].min}
          max={METRIC_RANGE[params.metric].max}
          step={params.metric === 'temp_c' ? 0.1 : 1}
          placeholder="No high limit"
          value={params.max}
          onChange={(v) => setParams((p) => ({ ...p, max: v }))}
          invalid={!validRange}
        />
      </div>
      {!validRange && (
        <p className="text-xs text-destructive">Lower bound must be less than upper bound.</p>
      )}
    </RuleCardShell>
  );
}
