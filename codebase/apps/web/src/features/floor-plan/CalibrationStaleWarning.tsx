import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CalibrationStaleWarningProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calibrationCount: number;
  saving: boolean;
  onConfirm: () => void;
}

export function CalibrationStaleWarning({
  open,
  onOpenChange,
  calibrationCount,
  saving,
  onConfirm,
}: CalibrationStaleWarningProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Calibration may be stale</DialogTitle>
          <DialogDescription>
            {calibrationCount === 1
              ? 'There is 1 calibration point captured against this floor plan.'
              : `There are ${calibrationCount} calibration points captured against this floor plan.`}{' '}
            Saving these changes may invalidate the position estimate accuracy. The points are kept
            on save so you can decide whether to recalibrate.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Recalibrating later: open the Calibration tab once F7 ships and re-walk the captured
          points.
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? 'Saving…' : 'Save anyway'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
