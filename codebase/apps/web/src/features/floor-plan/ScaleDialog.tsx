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
import { computeScale } from './canvasState';

interface ScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pixelLength: number | null;
  onConfirm: (metersPerPixel: number) => void;
}

export function ScaleDialog({ open, onOpenChange, pixelLength, onConfirm }: ScaleDialogProps) {
  const [value, setValue] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
    }
  }, [open]);

  const numeric = Number.parseFloat(value);
  const validInput =
    pixelLength != null && pixelLength > 0 && Number.isFinite(numeric) && numeric > 0;
  const previewScale = validInput ? computeScale(pixelLength!, numeric) : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pixelLength == null) {
      setError('Select a wall first.');
      return;
    }
    try {
      const scale = computeScale(pixelLength, numeric);
      onConfirm(scale);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set real-world scale</DialogTitle>
          <DialogDescription>
            Enter the real length of the selected wall. Every pixel on the canvas will be anchored
            to a metric distance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Selected line:{' '}
            <span className="font-mono text-foreground">
              {pixelLength != null ? `${pixelLength.toFixed(0)} px` : 'no line selected'}
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="metres">Length in metres</Label>
            <Input
              id="metres"
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
              placeholder="e.g. 5.0"
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
            <Button type="submit" disabled={!validInput}>
              Set scale
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
