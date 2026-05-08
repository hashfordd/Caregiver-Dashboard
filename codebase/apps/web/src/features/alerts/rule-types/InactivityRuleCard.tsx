import { useEffect, useState } from 'react';
import type { AlertSeverity, InactivityParams, InactivityRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: InactivityRule | null;
}

const DEFAULTS: InactivityParams = {
  inactive_minutes: 60,
};

export function InactivityRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);
  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'warn');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [params, setParams] = useState<InactivityParams>(rule?.params ?? DEFAULTS);
  const [windowEnabled, setWindowEnabled] = useState<boolean>(rule?.params.only_between != null);

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setParams(rule.params);
      setWindowEnabled(rule.params.only_between != null);
    } else {
      setDraftSeverity('warn');
      setDraftEnabled(true);
      setParams(DEFAULTS);
      setWindowEnabled(false);
    }
  }, [rule]);

  const validMinutes = Number.isFinite(params.inactive_minutes) && params.inactive_minutes > 0;
  const dirty =
    rule == null ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    JSON.stringify(rule.params) !== JSON.stringify(params);

  const previewRule: InactivityRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'inactivity',
    params,
    created_at: rule?.created_at ?? new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return (
    <RuleCardShell
      title="Inactivity"
      type="inactivity"
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
          type: 'inactivity',
          params,
          severity: draftSeverity,
          enabled: draftEnabled,
        })
      }
      onDelete={rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <FieldLabel label="Trigger after this many minutes without movement">
        <input
          type="number"
          min={1}
          value={params.inactive_minutes}
          onChange={(e) => setParams((p) => ({ ...p, inactive_minutes: Number(e.target.value) }))}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        />
      </FieldLabel>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={windowEnabled}
          onChange={(e) => {
            const next = e.target.checked;
            setWindowEnabled(next);
            setParams((p) =>
              next
                ? { ...p, only_between: p.only_between ?? { from: '08:00', to: '20:00' } }
                : { ...p, only_between: undefined },
            );
          }}
          className="h-3.5 w-3.5 accent-primary"
        />
        Only fire during a daytime window
      </label>
      {windowEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="From (caregiver-local)">
            <input
              type="time"
              value={params.only_between?.from ?? '08:00'}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  only_between: {
                    from: e.target.value,
                    to: p.only_between?.to ?? '20:00',
                  },
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          </FieldLabel>
          <FieldLabel label="To (caregiver-local)">
            <input
              type="time"
              value={params.only_between?.to ?? '20:00'}
              onChange={(e) =>
                setParams((p) => ({
                  ...p,
                  only_between: {
                    from: p.only_between?.from ?? '08:00',
                    to: e.target.value,
                  },
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          </FieldLabel>
        </div>
      )}
    </RuleCardShell>
  );
}
