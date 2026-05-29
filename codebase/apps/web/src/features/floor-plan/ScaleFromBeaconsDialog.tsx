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
import type { BeaconRow } from '@/features/beacons/types';
import { computeScaleFromBeacons } from './canvasState';

interface ScaleFromBeaconsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All beacons for the patient — we filter to placed ones (x_canvas + y_canvas non-null)
   *  inside the dialog so the parent doesn't need to. */
  beacons: BeaconRow[];
  onConfirm: (metersPerPixel: number) => void;
}

interface PlacedBeacon {
  id: string;
  label: string;
  x: number;
  y: number;
}

function toPlaced(rows: BeaconRow[]): PlacedBeacon[] {
  return rows
    .filter(
      (b): b is BeaconRow & { x_canvas: number; y_canvas: number } =>
        b.x_canvas != null && b.y_canvas != null,
    )
    .map((b) => ({
      id: b.id,
      label: b.label ?? `…${b.mac_address.slice(-5)}`,
      x: b.x_canvas,
      y: b.y_canvas,
    }));
}

/** Calibrate `scale_meters_per_pixel` from the measured real-world distance
 *  between two placed beacons. This is the rigorous calibration ritual:
 *  pick two beacons you can put a tape between, type the distance, and the
 *  system back-solves the scale. Replaces eyeballing a wall length, which
 *  was the only other path before this dialog.
 *
 *  Hidden behind the Toolbar's "Set scale" dropdown when ≥2 beacons are
 *  placed; the wall-length method stays available for floor plans without
 *  enough beacons to anchor. */
export function ScaleFromBeaconsDialog({
  open,
  onOpenChange,
  beacons,
  onConfirm,
}: ScaleFromBeaconsDialogProps) {
  const placed = useMemo(() => toPlaced(beacons), [beacons]);

  const [firstId, setFirstId] = useState<string>('');
  const [secondId, setSecondId] = useState<string>('');
  const [metresInput, setMetresInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Default to the first two placed beacons each time the dialog opens.
  // Resetting on `open` rather than mount means closing/reopening picks
  // up a freshly-placed beacon list.
  useEffect(() => {
    if (!open) return;
    setFirstId(placed[0]?.id ?? '');
    setSecondId(placed[1]?.id ?? '');
    setMetresInput('');
    setError(null);
  }, [open, placed]);

  const first = placed.find((p) => p.id === firstId) ?? null;
  const second = placed.find((p) => p.id === secondId) ?? null;
  const distinct = first != null && second != null && first.id !== second.id;

  const pixelDistance =
    first != null && second != null ? Math.hypot(second.x - first.x, second.y - first.y) : null;

  const metres = Number.parseFloat(metresInput);
  const metresValid = Number.isFinite(metres) && metres > 0;

  const previewScale = useMemo(() => {
    if (!distinct || pixelDistance == null || pixelDistance <= 0 || !metresValid) return null;
    try {
      return computeScaleFromBeacons(first!, second!, metres);
    } catch {
      return null;
    }
  }, [distinct, pixelDistance, metresValid, first, second, metres]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!distinct) {
      setError('Pick two different beacons.');
      return;
    }
    if (!metresValid) {
      setError('Enter the measured distance in metres.');
      return;
    }
    try {
      const scale = computeScaleFromBeacons(first!, second!, metres);
      onConfirm(scale);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (placed.length < 2) {
    // Render an informational dialog instead of just disabling the toolbar
    // entry so the user finds out *why* this path isn't available.
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place two beacons first</DialogTitle>
            <DialogDescription>
              Calibrating from beacons needs at least two placed beacons to act as the tape's
              endpoints. Open the Beacons sub-tab and place beacons before returning here.
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
          <DialogTitle>Set scale from two beacons</DialogTitle>
          <DialogDescription>
            Measure the real-world distance between two placed beacons with a tape, then enter it
            below. The system anchors every pixel on the canvas to that distance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="beacon-a">Beacon A</Label>
              <select
                id="beacon-a"
                value={firstId}
                onChange={(e) => {
                  setFirstId(e.target.value);
                  setError(null);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {placed.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="beacon-b">Beacon B</Label>
              <select
                id="beacon-b"
                value={secondId}
                onChange={(e) => {
                  setSecondId(e.target.value);
                  setError(null);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {placed.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Pixel distance:{' '}
            <span className="font-mono text-foreground">
              {pixelDistance != null && distinct
                ? `${pixelDistance.toFixed(0)} px`
                : 'pick two different beacons'}
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="metres-between">Measured distance in metres</Label>
            <Input
              id="metres-between"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              autoFocus
              value={metresInput}
              onChange={(e) => {
                setMetresInput(e.target.value);
                setError(null);
              }}
              placeholder="e.g. 4.2"
            />
            {previewScale != null && (
              <p className="text-xs text-muted-foreground">
                Preview: 1 px = {previewScale.toFixed(4)} m
              </p>
            )}
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!distinct || !metresValid}>
              Set scale
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
