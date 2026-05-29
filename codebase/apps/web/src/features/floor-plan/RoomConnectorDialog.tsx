import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CONNECTOR_KIND_LABEL,
  CONNECTOR_KINDS,
  type ConnectorKind,
  type RoomConnectorRow,
  type RoomRow,
  type UpsertRoomConnectorInput,
} from './roomTypes';

interface RoomConnectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  floorPlanId: string;
  rooms: RoomRow[];
  /** Provided when editing. Absent + presetKind set ⇒ adding a specific kind. */
  initial?: RoomConnectorRow | null;
  /** Pre-select the kind when adding from a kind-specific button
   *  ("Add door", "Add window"). Ignored when editing. */
  presetKind?: ConnectorKind;
  onConfirm: (input: UpsertRoomConnectorInput) => Promise<void> | void;
  submitting?: boolean;
}

function numberOrNaN(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return Number.NaN;
  return Number(trimmed);
}

/** Add / edit a `room_connectors` row. Endpoints are numeric x/y in
 *  canvas-pixel coordinates, matching the rooms polygon space so the
 *  rules engine can run distance checks against position estimates
 *  without unit conversion. Room A/B are optional joins — the prototype
 *  needs them only for caregiver-language rules like "patient left the
 *  bedroom via the door". */
export function RoomConnectorDialog({
  open,
  onOpenChange,
  patientId,
  floorPlanId,
  rooms,
  initial,
  presetKind,
  onConfirm,
  submitting,
}: RoomConnectorDialogProps) {
  const [kind, setKind] = useState<ConnectorKind>('door');
  const [startX, setStartX] = useState('');
  const [startY, setStartY] = useState('');
  const [endX, setEndX] = useState('');
  const [endY, setEndY] = useState('');
  const [roomAId, setRoomAId] = useState<string>('');
  const [roomBId, setRoomBId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? presetKind ?? 'door');
    setStartX(initial ? String(initial.start_x) : '');
    setStartY(initial ? String(initial.start_y) : '');
    setEndX(initial ? String(initial.end_x) : '');
    setEndY(initial ? String(initial.end_y) : '');
    setRoomAId(initial?.room_a_id ?? '');
    setRoomBId(initial?.room_b_id ?? '');
    setLabel(initial?.label ?? '');
    setSubmitError(null);
  }, [open, initial, presetKind]);

  const sx = numberOrNaN(startX);
  const sy = numberOrNaN(startY);
  const ex = numberOrNaN(endX);
  const ey = numberOrNaN(endY);
  const endpointsValid = [sx, sy, ex, ey].every(Number.isFinite);
  const endpointsDistinct = endpointsValid && (sx !== ex || sy !== ey);

  const segmentLengthPx = useMemo(
    () => (endpointsDistinct ? Math.hypot(ex - sx, ey - sy) : null),
    [endpointsDistinct, sx, sy, ex, ey],
  );

  const canSubmit = endpointsValid && endpointsDistinct && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!endpointsValid) {
      setSubmitError('All four endpoint coordinates must be numbers.');
      return;
    }
    if (!endpointsDistinct) {
      setSubmitError('Start and end must be different points (a zero-length segment is invalid).');
      return;
    }
    try {
      await onConfirm({
        id: initial?.id,
        patient_id: patientId,
        floor_plan_id: floorPlanId,
        kind,
        start_x: sx,
        start_y: sy,
        end_x: ex,
        end_y: ey,
        room_a_id: roomAId === '' ? null : roomAId,
        room_b_id: roomBId === '' ? null : roomBId,
        label: label.trim() === '' ? null : label.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to save.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit connector' : 'Add connector'}</DialogTitle>
          <DialogDescription>
            Doors, windows and openings are line segments anchored on canvas-pixel coordinates. Link
            to one or two rooms so rules can say "left bedroom via this door".
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="connector-kind">Kind</Label>
              <select
                id="connector-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ConnectorKind)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {CONNECTOR_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {CONNECTOR_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="connector-label">Label (optional)</Label>
              <Input
                id="connector-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Front door"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground/80">
              Endpoints (canvas px)
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="connector-sx" className="text-xs">
                  Start x
                </Label>
                <Input
                  id="connector-sx"
                  type="number"
                  inputMode="decimal"
                  value={startX}
                  onChange={(e) => setStartX(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="connector-sy" className="text-xs">
                  Start y
                </Label>
                <Input
                  id="connector-sy"
                  type="number"
                  inputMode="decimal"
                  value={startY}
                  onChange={(e) => setStartY(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="connector-ex" className="text-xs">
                  End x
                </Label>
                <Input
                  id="connector-ex"
                  type="number"
                  inputMode="decimal"
                  value={endX}
                  onChange={(e) => setEndX(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="connector-ey" className="text-xs">
                  End y
                </Label>
                <Input
                  id="connector-ey"
                  type="number"
                  inputMode="decimal"
                  value={endY}
                  onChange={(e) => setEndY(e.target.value)}
                />
              </div>
            </div>
            {segmentLengthPx != null && (
              <p className="text-[10px] text-muted-foreground">
                Segment length: {segmentLengthPx.toFixed(0)} px
              </p>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="connector-room-a">Room A (optional)</Label>
              <select
                id="connector-room-a"
                value={roomAId}
                onChange={(e) => setRoomAId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                disabled={rooms.length === 0}
              >
                <option value="">— none —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="connector-room-b">Room B (optional)</Label>
              <select
                id="connector-room-b"
                value={roomBId}
                onChange={(e) => setRoomBId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                disabled={rooms.length === 0}
              >
                <option value="">— none —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
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
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add connector'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
