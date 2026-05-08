import { useEffect, useMemo, useState } from 'react';
import type {
  AlertSeverity,
  IndoorZoneParams as IndoorZoneParamsT,
  ZoneRule,
} from '@alzcare/shared';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

interface Props {
  patientId: string;
  rule: ZoneRule | null;
}

const DEFAULT_INDOOR_PARAMS: IndoorZoneParamsT = {
  space: 'indoor',
  polygon: [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
  ],
  direction: 'enter',
  dwell_seconds: 0,
};

/** F11 V1: indoor zone polygons in floor-plan canvas coordinates. The
 *  dedicated on-canvas polygon picker is a follow-up task — for now
 *  this card exposes the polygon as JSON so caregivers can paste
 *  coordinates from the Place tab.
 *
 *  Phase C: zone rules now discriminate on `params.space`. This card
 *  edits the indoor branch only (canvas pixel polygons over the patient's
 *  floor plan); the outdoor geofence editor lives on the map view. Rules
 *  loaded from the DB that are outdoor (space === 'outdoor') are
 *  rendered as "create new" because their data shape doesn't match
 *  this card's editor. */
export function ZoneRuleCard({ patientId, rule }: Props) {
  const upsert = useUpsertAlertRule(patientId);
  const remove = useDeleteAlertRule(patientId);

  const isIndoorRule = rule?.params.space === 'indoor';
  const indoorRuleParams = isIndoorRule ? (rule.params as IndoorZoneParamsT) : null;

  const [draftSeverity, setDraftSeverity] = useState<AlertSeverity>(rule?.severity ?? 'critical');
  const [draftEnabled, setDraftEnabled] = useState<boolean>(rule?.enabled ?? true);
  const [direction, setDirection] = useState<IndoorZoneParamsT['direction']>(
    indoorRuleParams?.direction ?? 'enter',
  );
  const [dwellSeconds, setDwellSeconds] = useState<number>(indoorRuleParams?.dwell_seconds ?? 0);
  const [polygonText, setPolygonText] = useState<string>(
    JSON.stringify(indoorRuleParams?.polygon ?? DEFAULT_INDOOR_PARAMS.polygon, null, 2),
  );

  useEffect(() => {
    if (rule && rule.params.space === 'indoor') {
      const p = rule.params;
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setDirection(p.direction);
      setDwellSeconds(p.dwell_seconds);
      setPolygonText(JSON.stringify(p.polygon, null, 2));
    } else {
      setDraftSeverity('critical');
      setDraftEnabled(true);
      setDirection('enter');
      setDwellSeconds(0);
      setPolygonText(JSON.stringify(DEFAULT_INDOOR_PARAMS.polygon, null, 2));
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
  const draftParams: IndoorZoneParamsT | null = polygonResult.ok
    ? { space: 'indoor', polygon: polygonResult.polygon, direction, dwell_seconds: dwellSeconds }
    : null;

  const dirty =
    rule == null ||
    !isIndoorRule ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    (draftParams != null && JSON.stringify(rule.params) !== JSON.stringify(draftParams));

  const previewRule: ZoneRule = {
    id: rule?.id ?? 'preview',
    patient_id: patientId,
    severity: draftSeverity,
    enabled: draftEnabled,
    type: 'zone',
    params: draftParams ?? DEFAULT_INDOOR_PARAMS,
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
          id: isIndoorRule ? rule?.id : undefined,
          patient_id: patientId,
          type: 'zone',
          params: draftParams,
          severity: draftSeverity,
          enabled: draftEnabled,
        });
      }}
      onDelete={isIndoorRule && rule ? () => remove.mutate(rule.id) : undefined}
      preview={<RulePreview rule={previewRule} />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Direction">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as IndoorZoneParamsT['direction'])}
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
        Coordinates are in floor-plan canvas pixels. For outdoor lat/lng geofences, edit the rule
        from the patient's Map view instead. An on-canvas polygon picker is the next upgrade — see
        BACKLOG.
      </p>
    </RuleCardShell>
  );
}
