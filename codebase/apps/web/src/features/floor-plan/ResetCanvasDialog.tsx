import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ResetCanvasDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ResetCanvasDialog({ open, onOpenChange, onConfirm }: ResetCanvasDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear the floor plan?</DialogTitle>
          <DialogDescription>
            This removes every wall, room, and furniture item on the canvas. The scale and any
            paired beacons stay where they are. You can recover with Cmd/Ctrl+Z if you change your
            mind.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Clear canvas
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
