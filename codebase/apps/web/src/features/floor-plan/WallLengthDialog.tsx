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

interface WallLengthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current pixel length of the selected wall, or null if none selected. */
  pixelLength: number | null;
  /** Active scale (m/px) — required to convert between pixels and metres. */
  scaleMetersPerPixel: number | null;
  /** Called with the new length in metres after the user confirms. */
  onConfirm: (metres: number) => void;
}

export function WallLengthDialog({
  open,
  onOpenChange,
  pixelLength,
  scaleMetersPerPixel,
  onConfirm,
}: WallLengthDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentMetres =
    pixelLength != null && scaleMetersPerPixel != null && scaleMetersPerPixel > 0
      ? pixelLength * scaleMetersPerPixel
      : null;

  useEffect(() => {
    if (open) {
      setValue(currentMetres != null ? currentMetres.toFixed(2) : '');
      setError(null);
    }
  }, [open, currentMetres]);

  const numeric = Number.parseFloat(value);
  const validInput = Number.isFinite(numeric) && numeric > 0;
  const scaleReady = scaleMetersPerPixel != null && scaleMetersPerPixel > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scaleReady) {
      setError('Set a scale first (Set scale).');
      return;
    }
    if (!validInput) {
      setError('Enter a positive length in metres.');
      return;
    }
    onConfirm(numeric);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set wall length</DialogTitle>
          <DialogDescription>
            Enter the real-world length of this wall. Its angle and start point are kept; the far
            end moves to match.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Current:{' '}
            <span className="font-mono text-foreground">
              {pixelLength != null
                ? `${pixelLength.toFixed(0)} px${
                    currentMetres != null ? ` · ${currentMetres.toFixed(2)} m` : ''
                  }`
                : 'no wall selected'}
            </span>
          </div>
          {!scaleReady && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              No scale yet. Pick a wall and use Set scale to anchor pixels to metres before setting
              length.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="wall-length-m">New length (metres)</Label>
            <Input
              id="wall-length-m"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="e.g. 4.20"
              disabled={!scaleReady}
            />
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
            <Button type="submit" disabled={!scaleReady || !validInput}>
              Apply
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
