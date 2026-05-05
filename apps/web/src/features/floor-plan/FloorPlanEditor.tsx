import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CalibrationStaleWarning } from './CalibrationStaleWarning';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { ScaleDialog } from './ScaleDialog';
import { Toolbar } from './Toolbar';
import { formatScale } from './canvasState';
import { useCalibrationCount, useFloorPlan, useUpsertFloorPlan } from './floorPlanQueries';
import type { FloorPlanCanvasHandle, FurnitureKind, ToolMode } from './types';

interface FloorPlanEditorProps {
  patientId: string;
}

export function FloorPlanEditor({ patientId }: FloorPlanEditorProps) {
  const planQuery = useFloorPlan(patientId);
  const calibration = useCalibrationCount(planQuery.data?.id);
  const upsert = useUpsertFloorPlan(patientId);

  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);
  const [mode, setMode] = useState<ToolMode>('select');
  const [furnitureKind, setFurnitureKind] = useState<FurnitureKind>('bed');
  const [dirty, setDirty] = useState(false);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [pixelLength, setPixelLength] = useState<number | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [savedTone, setSavedTone] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // Hydrate scale from the loaded plan once.
  useEffect(() => {
    setScale(planQuery.data?.scale_meters_per_pixel ?? null);
  }, [planQuery.data?.id, planQuery.data?.scale_meters_per_pixel]);

  const handleModeChange = useCallback(
    (next: ToolMode) => {
      setMode(next);
      canvasRef.current?.setMode(next, furnitureKind);
    },
    [furnitureKind],
  );

  const handleFurnitureKindChange = useCallback((kind: FurnitureKind) => {
    setFurnitureKind(kind);
    canvasRef.current?.setFurnitureKind(kind);
  }, []);

  const handleDirty = useCallback(() => {
    setDirty(true);
    setSavedTone(null);
  }, []);

  const performSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const json = canvas.serialize();
    const result = await upsert.mutateAsync({
      id: planQuery.data?.id,
      patient_id: patientId,
      canvas_json: json,
      scale_meters_per_pixel: scale,
    });
    setDirty(false);
    setWarningOpen(false);
    setSavedTone(`Saved · ${new Date(result.created_at).toLocaleTimeString()}`);
  }, [patientId, planQuery.data?.id, scale, upsert]);

  const handleSave = useCallback(() => {
    if (!dirty) return;
    if ((calibration.data ?? 0) > 0) {
      setWarningOpen(true);
    } else {
      void performSave();
    }
  }, [calibration.data, dirty, performSave]);

  const handleSetScaleClick = useCallback(() => {
    const len = canvasRef.current?.getSelectedLinePixelLength() ?? null;
    setPixelLength(len);
    setScaleOpen(true);
  }, []);

  const handleScaleConfirmed = useCallback((next: number) => {
    setScale(next);
    setDirty(true);
  }, []);

  const handleDelete = useCallback(() => {
    canvasRef.current?.deleteSelected();
  }, []);

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  const handleFitToContent = useCallback(() => {
    canvasRef.current?.fitToContent();
  }, []);

  if (planQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (planQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn't load the floor plan</CardTitle>
          <CardDescription>{(planQuery.error as Error).message ?? 'Unknown error'}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => planQuery.refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const initialJson = planQuery.data?.canvas_json ?? null;
  const calibrationCount = calibration.data ?? 0;

  return (
    <div className="space-y-3">
      <Toolbar
        mode={mode}
        furnitureKind={furnitureKind}
        scaleLabel={formatScale(scale)}
        dirty={dirty}
        saving={upsert.isPending}
        canSetScale={mode === 'select'}
        onModeChange={handleModeChange}
        onFurnitureKindChange={handleFurnitureKindChange}
        onSetScale={handleSetScaleClick}
        onSave={handleSave}
        onDelete={handleDelete}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onFitToContent={handleFitToContent}
      />

      {savedTone && (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-xs text-foreground/80">{savedTone}</p>
      )}

      {upsert.isError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {(upsert.error as Error).message}
        </p>
      )}

      <div className="relative">
        <FloorPlanCanvas
          ref={canvasRef}
          initialJson={initialJson}
          scale={scale}
          onDirty={handleDirty}
          onModeChange={setMode}
          onIsEmptyChange={setIsEmpty}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-md">
              <EmptyState
                icon={<LayoutGrid className="h-10 w-10" />}
                title="A blank canvas"
                description="Start with the outer walls of the patient's space, then add internal rooms and key furniture. Hold Shift while drawing a wall to lock it horizontal or vertical; hold Space to pan; scroll to zoom."
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Shortcuts: Cmd/Ctrl+Z undo · Cmd/Ctrl+Shift+Z redo · Backspace delete · Shift while drawing
        for ortho · Space + drag to pan · scroll to zoom
      </p>

      <ScaleDialog
        open={scaleOpen}
        onOpenChange={setScaleOpen}
        pixelLength={pixelLength}
        onConfirm={handleScaleConfirmed}
      />

      <CalibrationStaleWarning
        open={warningOpen}
        onOpenChange={setWarningOpen}
        calibrationCount={calibrationCount}
        saving={upsert.isPending}
        onConfirm={performSave}
      />
    </div>
  );
}
