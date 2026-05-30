import { useEffect, useState } from 'react';
import type { AlertSeverity, RoomTransitionParams, RoomTransitionRule } from '@alzcare/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { RoomRow } from '@/features/floor-plan/roomTypes';
import { ROOM_TYPE_LABEL } from '@/features/floor-plan/roomTypes';
import { NumberField } from '../inputs/NumberField';

interface RoomTransitionRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  rooms: RoomRow[];
  initial?: RoomTransitionRule | null;
  onConfirm: (input: {
    id?: string;
    patient_id: string;
    type: 'room_transition';
    params: RoomTransitionParams;
    severity: AlertSeverity;
    enabled: boolean;
  }) => Promise<void> | void;
  submitting?: boolean;
}

const SEVERITIES: AlertSeverity[] = ['info', 'warn', 'critical'];

/** Phase C: add / edit a room_transition alert rule. Rooms list is
 *  driven by the floor-plan Rooms sub-tab — if it's empty, the dialog
 *  surfaces an explainer rather than silently letting the caregiver
 *  submit an unresolvable room_id. */
export function RoomTransitionRuleDialog({
  open,
  onOpenChange,
  patientId,
  rooms,
  initial,
  onConfirm,
  submitting,
}: RoomTransitionRuleDialogProps) {
  const [roomId, setRoomId] = useState<string>('');
  const [direction, setDirection] = useState<'enter' | 'exit'>('enter');
  const [dwellSeconds, setDwellSeconds] = useState<number>(0);
  const [severity, setSeverity] = useState<AlertSeverity>('warn');
  const [enabled, setEnabled] = useState<boolean>(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoomId(initial?.params.room_id ?? rooms[0]?.id ?? '');
    setDirection(initial?.params.direction ?? 'enter');
    setDwellSeconds(initial?.params.dwell_seconds ?? 0);
    setSeverity(initial?.severity ?? 'warn');
    setEnabled(initial?.enabled ?? true);
    setSubmitError(null);
  }, [open, initial, rooms]);

  const canSubmit =
    roomId !== '' && Number.isFinite(dwellSeconds) && dwellSeconds >= 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await onConfirm({
        id: initial?.id,
        patient_id: patientId,
        type: 'room_transition',
        params: {
          room_id: roomId,
          direction,
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

  if (rooms.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Define a room first</DialogTitle>
            <DialogDescription>
              Room transition rules need at least one named room polygon. Open Place → Rooms, add a
              room, then return here.
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
            {initial ? 'Edit room transition rule' : 'Add room transition rule'}
          </DialogTitle>
          <DialogDescription>
            Fires when the patient enters or leaves a specific room polygon.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rt-room">Room</Label>
            <select
              id="rt-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {ROOM_TYPE_LABEL[r.room_type]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rt-direction">Direction</Label>
              <select
                id="rt-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'enter' | 'exit')}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="enter">Entered</option>
                <option value="exit">Left</option>
              </select>
            </div>
            <NumberField
              label="Hold for"
              description="Seconds before alerting (0 = immediately)."
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
              <Label htmlFor="rt-severity">Severity</Label>
              <select
                id="rt-severity"
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
