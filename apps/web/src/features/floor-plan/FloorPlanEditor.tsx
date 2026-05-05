import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CalibrationStaleWarning } from './CalibrationStaleWarning';
import { FloorPlanCanvas } from './FloorPlanCanvas';
import { ResetCanvasDialog } from './ResetCanvasDialog';
import { ScaleDialog } from './ScaleDialog';
import { Toolbar } from './Toolbar';
import { WallLengthDialog } from './WallLengthDialog';
import { formatScale } from './canvasState';
import { useCalibrationCount, useFloorPlan, useUpsertFloorPlan } from './floorPlanQueries';
import type { FloorPlanCanvasHandle, FurnitureKind, SelectionDescriptor, ToolMode } from './types';

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
  const [wallLengthOpen, setWallLengthOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pixelLength, setPixelLength] = useState<number | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [savedTone, setSavedTone] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [selection, setSelection] = useState<SelectionDescriptor>({ kind: 'none' });
  const [remoteVersionPending, setRemoteVersionPending] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [editing, setEditing] = useState(false);

  const lastLoadedVersionRef = useRef<string | null>(null);

  // Hydrate scale from the loaded plan once.
  useEffect(() => {
    setScale(planQuery.data?.scale_meters_per_pixel ?? null);
  }, [planQuery.data?.id, planQuery.data?.scale_meters_per_pixel]);

  // Reload the canvas when the server version changes — unless the caregiver
  // has unsaved changes, in which case we surface a "remote update" pill so
  // they can choose to discard or keep editing.
  useEffect(() => {
    const created = planQuery.data?.created_at;
    if (!created) return;
    if (lastLoadedVersionRef.current === created) return;
    if (lastLoadedVersionRef.current === null) {
      // First load — the canvas mounts with initialJson, no need to reload.
      lastLoadedVersionRef.current = created;
      return;
    }
    if (dirty) {
      setRemoteVersionPending(true);
      return;
    }
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json);
    lastLoadedVersionRef.current = created;
    setRemoteVersionPending(false);
  }, [planQuery.data?.created_at, planQuery.data?.canvas_json, dirty]);

  const handleModeChange = useCallback((next: ToolMode) => {
    setMode(next);
    // Don't pass furnitureKind here — handleFurnitureKindChange has already
    // pushed it into the canvas ref. Reading furnitureKind from React state
    // gives us the previous render's value and silently overwrites the
    // freshly-picked kind, which is why "click Bed" used to drop a chair.
    canvasRef.current?.setMode(next);
  }, []);

  const handleFurnitureKindChange = useCallback((kind: FurnitureKind) => {
    setFurnitureKind(kind);
    canvasRef.current?.setFurnitureKind(kind);
  }, []);

  const handleDirty = useCallback(() => {
    setDirty(true);
    setSavedTone(null);
  }, []);

  const handleSelectionChange = useCallback((desc: SelectionDescriptor) => {
    setSelection(desc);
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
    // Track the just-saved version so the refetch effect doesn't reload.
    lastLoadedVersionRef.current = result.created_at;
    setRemoteVersionPending(false);
    // Saving exits edit mode — the floor plan is locked again until the
    // caregiver explicitly clicks Edit.
    setEditing(false);
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

  const handleSetWallLengthClick = useCallback(() => {
    const len = canvasRef.current?.getSelectedLinePixelLength() ?? null;
    setPixelLength(len);
    setWallLengthOpen(true);
  }, []);

  const handleScaleConfirmed = useCallback((next: number) => {
    setScale(next);
    setDirty(true);
  }, []);

  const handleWallLengthConfirmed = useCallback(
    (metres: number) => {
      if (scale == null) return;
      canvasRef.current?.setSelectedWallLength(metres, scale);
      setDirty(true);
    },
    [scale],
  );

  const handleDelete = useCallback(() => {
    canvasRef.current?.deleteSelected();
  }, []);

  const handleResetRequest = useCallback(() => {
    setResetOpen(true);
  }, []);

  const handleResetConfirm = useCallback(() => {
    canvasRef.current?.clearAll();
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

  const handleToggleDimensions = useCallback(() => {
    setShowDimensions((v) => !v);
  }, []);

  const handleEdit = useCallback(() => {
    setEditing(true);
  }, []);

  const handleDiscard = useCallback(() => {
    // Restore the canvas to whatever the server has on file.
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json ?? null);
    setDirty(false);
    setEditing(false);
    setSavedTone(null);
  }, [planQuery.data?.canvas_json]);

  const handleAcceptRemote = useCallback(() => {
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json);
    setDirty(false);
    setRemoteVersionPending(false);
    if (planQuery.data?.created_at) {
      lastLoadedVersionRef.current = planQuery.data.created_at;
    }
  }, [planQuery.data?.canvas_json, planQuery.data?.created_at]);

  if (planQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[min(82vh,960px)] min-h-[640px] w-full" />
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
        scaleSet={scale != null && scale > 0}
        selection={selection}
        dirty={dirty}
        saving={upsert.isPending}
        showDimensions={showDimensions}
        editing={editing}
        onModeChange={handleModeChange}
        onFurnitureKindChange={handleFurnitureKindChange}
        onSetScale={handleSetScaleClick}
        onSetWallLength={handleSetWallLengthClick}
        onSave={handleSave}
        onDelete={handleDelete}
        onReset={handleResetRequest}
        canReset={!isEmpty}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onFitToContent={handleFitToContent}
        onToggleDimensions={handleToggleDimensions}
        onEdit={handleEdit}
        onDiscard={handleDiscard}
      />

      {savedTone && (
        <p className="rounded-md bg-accent/10 px-3 py-2 text-xs text-foreground/80">{savedTone}</p>
      )}

      {remoteVersionPending && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <span>Another caregiver saved a newer version of this floor plan.</span>
          <Button size="sm" variant="outline" onClick={handleAcceptRemote}>
            Reload (lose unsaved)
          </Button>
        </div>
      )}

      {upsert.isError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {(upsert.error as Error).message}
        </p>
      )}

      <div className="relative h-[min(82vh,960px)] min-h-[640px] w-full">
        <FloorPlanCanvas
          ref={canvasRef}
          initialJson={initialJson}
          scale={scale}
          showDimensions={showDimensions}
          editing={editing}
          onDirty={handleDirty}
          onModeChange={setMode}
          onIsEmptyChange={setIsEmpty}
          onSelectionChange={handleSelectionChange}
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto max-w-md">
              <EmptyState
                icon={<LayoutGrid className="h-10 w-10" />}
                title="A blank canvas"
                description={
                  editing
                    ? 'Draw outer walls (Wall tool), then click Polygon to outline rooms with any shape — vertices snap to nearby wall ends. Hold Shift while drawing a wall to lock horizontal/vertical; hold Space to pan; scroll to zoom.'
                    : 'No floor plan yet. Click Edit in the toolbar to start drawing.'
                }
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Walls: click to start, click again to finish (next click can snap to a join). Shortcuts:
        Cmd/Ctrl+Z undo · Cmd/Ctrl+Shift+Z redo · Cmd/Ctrl+A select all · Backspace delete · Shift
        while drawing for ortho · Space + drag to pan · scroll to zoom · Enter to finish a polygon ·
        Esc to cancel/exit
      </p>

      <ScaleDialog
        open={scaleOpen}
        onOpenChange={setScaleOpen}
        pixelLength={pixelLength}
        onConfirm={handleScaleConfirmed}
      />

      <WallLengthDialog
        open={wallLengthOpen}
        onOpenChange={setWallLengthOpen}
        pixelLength={pixelLength}
        scaleMetersPerPixel={scale}
        onConfirm={handleWallLengthConfirmed}
      />

      <ResetCanvasDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        onConfirm={handleResetConfirm}
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
