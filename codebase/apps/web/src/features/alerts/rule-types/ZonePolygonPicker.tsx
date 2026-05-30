import { useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FloorPlanCanvas } from '@/features/floor-plan/FloorPlanCanvas';
import { useFloorPlan } from '@/features/floor-plan/floorPlanQueries';
import type { FloorPlanCanvasHandle, RoomSprite } from '@/features/floor-plan/types';

interface ZonePolygonPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** Existing zone polygon (canvas coords), shown as read-only context. */
  initialPolygon: [number, number][] | null;
  onConfirm: (polygon: [number, number][]) => void;
}

/** Draw an indoor alert zone directly on the patient's floor plan, reusing the
 *  same polygon-draw machinery as the Place tab's room tool. Replaces the old
 *  raw-JSON coordinate textarea: the caregiver clicks corners on the plan and
 *  closes the shape, and we read back the world-coord vertices. Nothing here is
 *  persisted to the floor plan — only the polygon is handed back to the rule. */
export function ZonePolygonPicker({
  open,
  onOpenChange,
  patientId,
  initialPolygon,
  onConfirm,
}: ZonePolygonPickerProps) {
  const planQuery = useFloorPlan(patientId);
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = planQuery.data ?? null;

  // On open (and once the plan is ready), arm polygon drawing and show the
  // current zone as a read-only overlay for context.
  useEffect(() => {
    if (!open || plan == null) return;
    setError(null);
    const id = window.setTimeout(() => {
      if (initialPolygon && initialPolygon.length >= 3) {
        const sprite: RoomSprite = {
          id: 'current-zone',
          name: 'Current zone',
          roomType: 'other',
          polygon: initialPolygon,
        };
        canvasRef.current?.setRooms([sprite]);
      }
      canvasRef.current?.setMode('polygon');
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, plan, initialPolygon]);

  function handleUse() {
    const verts = canvasRef.current?.getSelectedPolygonVertices() ?? null;
    if (!verts || verts.length < 3) {
      setError(
        'Finish drawing the zone first — click each corner, then click the first corner again to close it.',
      );
      return;
    }
    onConfirm(verts);
    onOpenChange(false);
  }

  function handleRedraw() {
    canvasRef.current?.deleteSelected();
    canvasRef.current?.setMode('polygon');
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Draw the alert zone</DialogTitle>
          <DialogDescription>
            Click on the floor plan to drop each corner of the zone, then click the first corner
            again to close the shape.
          </DialogDescription>
        </DialogHeader>

        {plan == null ? (
          <EmptyState
            icon={<LayoutGrid className="h-10 w-10" />}
            title="No floor plan yet"
            description="Set up the patient's floor plan in the Place tab first — then you can draw an alert zone on it."
          />
        ) : (
          <div className="space-y-3">
            <div className="aspect-[4/3] max-h-[58vh] w-full overflow-hidden rounded-lg border border-border bg-card">
              <FloorPlanCanvas
                ref={canvasRef}
                initialJson={plan.canvas_json ?? null}
                scale={plan.scale_meters_per_pixel ?? null}
                editing
                initialMode="polygon"
                showDimensions
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleRedraw}>
                Start over
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleUse}>
                  Use this shape
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
