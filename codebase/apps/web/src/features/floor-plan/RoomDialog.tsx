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
  parsePolygonText,
  polygonToText,
  ROOM_TYPE_LABEL,
  ROOM_TYPES,
  type RoomRow,
  type RoomType,
  type UpsertRoomInput,
} from './roomTypes';

interface RoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  floorPlanId: string;
  /** Provided when editing an existing row; absent when adding. */
  initial?: RoomRow | null;
  /** Phase B polish: when set AND there is no `initial`, hydrate the
   *  polygon textarea from these vertices. Used by "Promote selected
   *  polygon to room" so the caregiver doesn't retype coords. */
  seedPolygon?: [number, number][];
  onConfirm: (input: UpsertRoomInput) => Promise<void> | void;
  /** Disables the submit while the mutation is in flight. */
  submitting?: boolean;
}

const POLYGON_PLACEHOLDER = `# One vertex per line as "x, y"\n100, 100\n400, 100\n400, 300\n100, 300`;

/** Add / edit a `rooms` row. Polygon is entered as a textarea — one
 *  "x, y" per line — until canvas-side picking ships in the next phase.
 *  The SVG preview gives immediate visual confirmation the entered
 *  coords describe a sensible shape so caregivers don't have to switch
 *  tabs and save to discover a typo. */
export function RoomDialog({
  open,
  onOpenChange,
  patientId,
  floorPlanId,
  initial,
  seedPolygon,
  onConfirm,
  submitting,
}: RoomDialogProps) {
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('other');
  const [polygonText, setPolygonText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset / hydrate on each open. `initial` switching means edit vs add.
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setRoomType(initial?.room_type ?? 'other');
    const seededText = initial
      ? polygonToText(initial.polygon_canvas)
      : seedPolygon
        ? polygonToText(seedPolygon)
        : '';
    setPolygonText(seededText);
    setSubmitError(null);
  }, [open, initial, seedPolygon]);

  const parsed = useMemo(() => parsePolygonText(polygonText), [polygonText]);

  const nameTrimmed = name.trim();
  const canSubmit = nameTrimmed.length > 0 && parsed.ok && !submitting;

  const previewBox = useMemo(() => {
    if (!parsed.ok) return null;
    const xs = parsed.polygon.map(([x]) => x);
    const ys = parsed.polygon.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    return { minX, minY, width, height };
  }, [parsed]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.ok) {
      setSubmitError(parsed.error);
      return;
    }
    if (nameTrimmed === '') {
      setSubmitError('Name is required.');
      return;
    }
    try {
      await onConfirm({
        id: initial?.id,
        patient_id: patientId,
        floor_plan_id: floorPlanId,
        name: nameTrimmed,
        room_type: roomType,
        polygon_canvas: parsed.polygon,
      });
      onOpenChange(false);
    } catch (err) {
      setSubmitError((err as Error).message ?? 'Failed to save.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit room' : 'Add room'}</DialogTitle>
          <DialogDescription>
            Define a polygon in canvas-pixel coordinates. The rules engine uses these polygons to
            decide whether the patient is inside the room, so name it the way a caregiver would say
            it ("Master bedroom", not "Polygon 1").
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="room-name">Name</Label>
              <Input
                id="room-name"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSubmitError(null);
                }}
                placeholder="Master bedroom"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room-type">Type</Label>
              <select
                id="room-type"
                value={roomType}
                onChange={(e) => setRoomType(e.target.value as RoomType)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ROOM_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <Label htmlFor="room-polygon">Polygon vertices</Label>
              <textarea
                id="room-polygon"
                value={polygonText}
                onChange={(e) => {
                  setPolygonText(e.target.value);
                  setSubmitError(null);
                }}
                placeholder={POLYGON_PLACEHOLDER}
                className="h-40 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-xs"
                aria-invalid={!parsed.ok && polygonText.trim() !== ''}
              />
              <p className="text-[10px] text-muted-foreground">
                One vertex per line as "x, y". Lines starting with # are comments. Minimum 3
                vertices; the polygon is closed automatically.
              </p>
              {!parsed.ok && polygonText.trim() !== '' && (
                <p className="text-xs text-destructive">
                  {parsed.line ? `Line ${parsed.line}: ` : ''}
                  {parsed.error}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="aspect-square w-full rounded-md border border-border bg-muted/30 p-2">
                {parsed.ok && previewBox ? (
                  <svg
                    viewBox={`${previewBox.minX - 4} ${previewBox.minY - 4} ${previewBox.width + 8} ${previewBox.height + 8}`}
                    className="h-full w-full"
                    role="img"
                    aria-label="Polygon preview"
                  >
                    <polygon
                      points={parsed.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
                      fill="currentColor"
                      fillOpacity={0.15}
                      stroke="currentColor"
                      strokeWidth={Math.max(previewBox.width, previewBox.height) / 200}
                      className="text-primary"
                    />
                  </svg>
                ) : (
                  <p className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    Type vertices to preview
                  </p>
                )}
              </div>
              {parsed.ok && (
                <p className="text-[10px] text-muted-foreground">
                  {parsed.polygon.length} vertices
                </p>
              )}
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
              {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add room'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
