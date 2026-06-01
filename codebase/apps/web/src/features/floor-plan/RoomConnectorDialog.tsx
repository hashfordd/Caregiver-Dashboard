import { useEffect, useState } from 'react';
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

/** Edit a `room_connectors` row's metadata — kind, label, and the optional
 *  room A/B links the rules engine uses for caregiver-language alerts like
 *  "patient left the bedroom via the door". The segment's position is NOT
 *  edited here: a care provider drags the door/window line directly on the
 *  floor plan, so the stored endpoints pass through unchanged. */
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
  const [roomAId, setRoomAId] = useState<string>('');
  const [roomBId, setRoomBId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? presetKind ?? 'door');
    setRoomAId(initial?.room_a_id ?? '');
    setRoomBId(initial?.room_b_id ?? '');
    setLabel(initial?.label ?? '');
    setSubmitError(null);
  }, [open, initial, presetKind]);

  // Position is owned by the canvas (drag the line), so a connector can only
  // be edited here once it exists with endpoints to preserve.
  const canSubmit = initial != null && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!initial) {
      setSubmitError('Draw the door or window on the floor plan first, then edit it here.');
      return;
    }
    try {
      await onConfirm({
        id: initial.id,
        patient_id: patientId,
        floor_plan_id: floorPlanId,
        kind,
        // Geometry is unchanged — repositioning happens by dragging on canvas.
        start_x: initial.start_x,
        start_y: initial.start_y,
        end_x: initial.end_x,
        end_y: initial.end_y,
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
          <DialogTitle>Edit connector</DialogTitle>
          <DialogDescription>
            Set the kind, an optional label, and link to one or two rooms so rules can say "left
            bedroom via this door". To reposition it, drag the line on the floor plan.
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
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
