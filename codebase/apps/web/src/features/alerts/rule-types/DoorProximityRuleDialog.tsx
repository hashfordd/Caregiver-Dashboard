import { useEffect, useState } from 'react';
import type { AlertSeverity, DoorProximityParams, DoorProximityRule } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { CONNECTOR_KIND_LABEL, type RoomConnectorRow } from '@/features/floor-plan/roomTypes';
import { NumberField } from '../inputs/NumberField';

interface DoorProximityRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  connectors: RoomConnectorRow[];
  initial?: DoorProximityRule | null;
  onConfirm: (input: {
    id?: string;
    patient_id: string;
    type: 'door_proximity';
    params: DoorProximityParams;
    severity: AlertSeverity;
    enabled: boolean;
  }) => Promise<void> | void;
  submitting?: boolean;
}

const SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];

/** Phase C: add / edit a door_proximity alert rule. Connectors list is
 *  driven by the Rooms sub-tab; the dialog gates on at least one door
 *  / window / opening existing so caregivers don't end up with a rule
 *  that references nothing. */
export function DoorProximityRuleDialog({
  open,
  onOpenChange,
  patientId,
  connectors,
  initial,
  onConfirm,
  submitting,
}: DoorProximityRuleDialogProps) {
  const [connectorId, setConnectorId] = useState<string>('');
  const [radiusM, setRadiusM] = useState<number>(1.5);
  const [dwellSeconds, setDwellSeconds] = useState<number>(0);
  const [severity, setSeverity] = useState<AlertSeverity>('warn');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConnectorId(initial?.params.connector_id ?? connectors[0]?.id ?? '');
    setRadiusM(initial?.params.radius_m ?? 1.5);
    setDwellSeconds(initial?.params.dwell_seconds ?? 0);
    setSeverity(initial?.severity ?? 'warn');
    setEnabled(initial?.enabled ?? true);
    setSubmitError(null);
  }, [open, initial, connectors]);

  const canSubmit =
    connectorId !== '' &&
    Number.isFinite(radiusM) &&
    radiusM > 0 &&
    Number.isFinite(dwellSeconds) &&
    dwellSeconds >= 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await onConfirm({
        id: initial?.id,
        patient_id: patientId,
        type: 'door_proximity',
        params: {
          connector_id: connectorId,
          radius_m: radiusM,
          dwell_seconds: Math.floor(dwellSeconds),
        },
        severity,
        enabled,
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to save.');
    }
  }

  if (connectors.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Define a door, window or opening first</DialogTitle>
            <DialogDescription>
              Door-proximity rules need at least one connector segment. Open Place → Rooms, add a
              door or window, then return here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial ? 'Edit door proximity rule' : 'Add door proximity rule'}
          </DialogTitle>
          <DialogDescription>
            Fires when the patient sits within the given radius of a specific door, window or
            opening for the dwell period.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dp-connector">Door / window / opening</Label>
            <select
              id="dp-connector"
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? CONNECTOR_KIND_LABEL[c.kind]} · {CONNECTOR_KIND_LABEL[c.kind]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Distance from the door"
              description="How close counts as “at the door”."
              unit="m"
              min={0.5}
              max={5}
              step={0.5}
              value={radiusM}
              onChange={(v) => setRadiusM(v ?? radiusM)}
              presets={[
                { label: '0.5 m', value: 0.5 },
                { label: '1 m', value: 1 },
                { label: '1.5 m', value: 1.5 },
                { label: '2 m', value: 2 },
              ]}
            />
            <NumberField
              label="Hold for"
              description="Seconds spent near it before alerting (0 = immediately)."
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="dp-severity">Severity</Label>
              <select
                id="dp-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                Enabled
              </label>
            </div>
          </div>

          {submitError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add rule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
