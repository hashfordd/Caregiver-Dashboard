import { lazy, Suspense, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import type {
  AlertSeverity,
  IndoorZoneParams as IndoorZoneParamsT,
  ZoneRule,
} from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import { useDeleteAlertRule, useUpsertAlertRule } from '../useAlertRules';
import { RulePreview } from '../RulePreview';
import { NumberField } from '../inputs/NumberField';
import { FieldLabel, RuleCardShell } from './RuleCardShell';

// Fabric.js is heavy and only needed when the caregiver opens the picker, so
// the on-plan zone editor is split out of the settings bundle.
const ZonePolygonPicker = lazy(() =>
  import('./ZonePolygonPicker').then((m) => ({ default: m.ZonePolygonPicker })),
);

interface Props {
  patientId: string;
  rule: ZoneRule | null;
}

/** F11 V1: indoor zone polygons in floor-plan canvas coordinates. The polygon
 *  is drawn directly on the floor plan via ZonePolygonPicker (reusing the Place
 *  tab's room-drawing tool) — no more pasting raw coordinate JSON.
 *
 *  Phase C: zone rules discriminate on `params.space`. This card edits the
 *  indoor branch only (canvas pixel polygons over the patient's floor plan);
 *  outdoor geofences are edited from the map view. Rules loaded from the DB
 *  that are outdoor render as "create new" because their shape doesn't match
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
  const [polygon, setPolygon] = useState<[number, number][]>(indoorRuleParams?.polygon ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (rule && rule.params.space === 'indoor') {
      const p = rule.params;
      setDraftSeverity(rule.severity);
      setDraftEnabled(rule.enabled);
      setDirection(p.direction);
      setDwellSeconds(p.dwell_seconds);
      setPolygon(p.polygon);
    } else {
      setDraftSeverity('critical');
      setDraftEnabled(true);
      setDirection('enter');
      setDwellSeconds(0);
      setPolygon([]);
    }
  }, [rule]);

  const validPolygon = polygon.length >= 3;
  const validDwell = Number.isFinite(dwellSeconds) && dwellSeconds >= 0;
  const draftParams: IndoorZoneParamsT | null = validPolygon
    ? { space: 'indoor', polygon, direction, dwell_seconds: dwellSeconds }
    : null;

  const dirty =
    rule == null ||
    !isIndoorRule ||
    rule.severity !== draftSeverity ||
    rule.enabled !== draftEnabled ||
    (draftParams != null && JSON.stringify(rule.params) !== JSON.stringify(draftParams));

  const previewRule: ZoneRule | null = draftParams
    ? {
        id: rule?.id ?? 'preview',
        patient_id: patientId,
        severity: draftSeverity,
        enabled: draftEnabled,
        type: 'zone',
        params: draftParams,
        created_at: rule?.created_at ?? new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      }
    : null;

  return (
    <RuleCardShell
      title="Zone (indoor area)"
      type="zone"
      severity={draftSeverity}
      enabled={draftEnabled}
      onSeverityChange={setDraftSeverity}
      onEnabledChange={setDraftEnabled}
      saveDisabled={!dirty || !validPolygon || !validDwell}
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
      preview={
        previewRule ? (
          <RulePreview rule={previewRule} />
        ) : (
          <span>Draw a zone on the floor plan to see a 24-hour preview.</span>
        )
      }
    >
      <p className="text-xs text-muted-foreground">
        Alerts when the patient enters or leaves an area you draw on the floor plan — e.g. the
        kitchen, a stairwell, or the front hallway.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Alert when the patient…">
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as IndoorZoneParamsT['direction'])}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="enter">Enters the zone</option>
            <option value="exit">Leaves the zone</option>
          </select>
        </FieldLabel>
        <NumberField
          label="Hold for"
          description="Seconds inside/outside before alerting (0 = immediately)."
          unit="s"
          min={0}
          max={600}
          value={dwellSeconds}
          onChange={(v) => setDwellSeconds(v ?? dwellSeconds)}
          presets={[
            { label: 'Now', value: 0 },
            { label: '10 s', value: 10 },
            { label: '30 s', value: 30 },
            { label: '1 min', value: 60 },
          ]}
        />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {validPolygon ? `Zone drawn · ${polygon.length} corners` : 'No zone drawn yet'}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {validPolygon ? 'Edit on floor plan' : 'Draw on floor plan'}
        </Button>
      </div>
      {!validPolygon && (
        <p className="text-xs text-destructive">
          Draw a zone on the floor plan to enable this rule.
        </p>
      )}

      {pickerOpen && (
        <Suspense fallback={null}>
          <ZonePolygonPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            patientId={patientId}
            initialPolygon={validPolygon ? polygon : null}
            onConfirm={(verts) => setPolygon(verts)}
          />
        </Suspense>
      )}
    </RuleCardShell>
  );
}
