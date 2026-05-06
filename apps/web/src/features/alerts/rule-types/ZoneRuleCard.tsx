import { useEffect, useMemo, useState } from 'react';
import type { AlertSeverity, ZoneParams, ZoneRule } from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: ZoneRule | null;
}

const DEFAULTS: ZoneParams = {
  polygon: [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
  ],
  direction: 'enter',
  dwell_seconds: 0,
};

/** F11 V1: zone polygons in floor-plan canvas coordinates. The dedicated
 *  on-canvas polygon picker is a follow-up task — for now this card
 *  exposes the polygon as JSON so caregivers can paste coordinates from
 *  the Place tab. The textarea round-trips through `JSON.parse` on save
 *  and the engine validates the shape via `AlertRuleParams`. */
export function ZoneRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);

  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'critical');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [direction, setDirection] = useState<ZoneParams['direction']>(
    rule?.params.direction ?? 'enter',
  );
  const [dwellSeconds, setDwellSeconds] = useState<number>(rule?.params.dwell_seconds ?? 0);
  const [polygonText, setPolygonText] = useState<string>(
    JSON.stringify(rule?.params.polygon ?? DEFAULTS.polygon, null, 2),
  );

  useEffect(() => {
    if (rule) {
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setDirection(rule.params.direction);
      setDwellSeconds(rule.params.dwell_seconds);
      setPolygonText(JSON.stringify(rule.params.polygon, null, 2));
    } else {
      setDraftSeverity('critical');
      setDraftEnabled(true);
      setDirection('enter');
      setDwellSeconds(0);
      setPolygonText(JSON.stringify(DEFAULTS.polygon, null, 2));
    }
  }, [rule]);

  const polygonResult = useMemo<
    { ok: true; polygon: [number, number][] } | { ok: false; error: string }
  >(() => {
    try {
      const parsed = JSON.parse(polygonText) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length < 3 ||
        !parsed.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            typeof p[0] === 'number' &&
            typeof p[1] === 'number',
        )
      ) {
        return {
          ok: false,
          error: 'Expected an array of ≥3 [x, y] pairs in canvas coords.',
        };
      }
      return { ok: true, polygon: parsed as [number, number][] };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, [polygonText]);

  const validDwell = Number.isFinite(dwellSeconds) && dwellSeconds >= 0;
  const draftParams: ZoneParams | null = polygonResult.ok
    ? { polygon: polygonResult.polygon, direction, dwell_seconds: dwellSeconds }
    : null;

  const dirty =
    rule == null ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    (draftParams != null && JSON.stringify(rule.params) !== JSON.stringify(draftParams));

  const previewRule: ZoneRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'zone',
    params: draftParams ?? DEFAULTS,
    created_at: rule?.created_at ?? new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return (
    <RuleCardShell
      title="Zone (indoor canvas polygon)"
      type="zone"
      severity={draftSeverity}
      enabled={draftEnabled}
      onSeverityChange={setDraftSeverity}
      onEnabledChange={setDraftEnabled}
      saveDisabled={!dirty || !polygonResult.ok || !validDwell}
      saving={upsert.isPending}
      saveError={upsert.error ? (upsert.error as Error).message : null}
      onSave={() => {
        if (!draftParams) return;
        upsert.mutate({
          id: rule?.id,
          patient_id: patientId,
          type: 'zone',
          params: draftParams,
          severity: draftSeverity,
          enabled: draftEnabled,
        });
      }}
      onDelete={rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Direction">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as ZoneParams['direction'])}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="enter">Fire on entering polygon</option>
            <option value="exit">Fire on leaving polygon</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Dwell seconds (0 = immediate)">
          <input
            type="number"
            min={0}
            value={dwellSeconds}
            onChange={(e) => setDwellSeconds(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
        </FieldLabel>
      </div>
      <FieldLabel label="Polygon — array of [x_canvas, y_canvas] pairs (≥3)">
        <textarea
          value={polygonText}
          onChange={(e) => setPolygonText(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
        />
      </FieldLabel>
      {!polygonResult.ok && <p className="text-xs text-destructive">{polygonResult.error}</p>}
      <p className="text-xs text-muted-foreground">
        Coordinates are in floor-plan canvas pixels. An on-canvas polygon picker is the next upgrade
        — see BACKLOG.
      </p>
    </RuleCardShell>
  );
}
