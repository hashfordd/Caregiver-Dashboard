import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bluetooth, LayoutGrid, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BeaconCalibrationDialog } from '@/features/beacons/BeaconCalibrationDialog';
import {
  useBeacons,
  useDeleteBeacon,
  useUpdateBeaconPosition,
} from '@/features/beacons/beaconQueries';
import { PairDialog } from '@/features/beacons/PairDialog';
import { isPlaced, type BeaconRow } from '@/features/beacons/types';
import {
  useCalibrationPoints,
  useDeleteCalibrationPoint,
} from '@/features/calibration/calibrationQueries';
import { CalibrationStaleWarning } from '@/features/floor-plan/CalibrationStaleWarning';
import { FloorPlanCanvas } from '@/features/floor-plan/FloorPlanCanvas';
import { computeScale, formatScale } from '@/features/floor-plan/canvasState';
import {
  useCalibrationCount,
  useFloorPlan,
  useUpsertFloorPlan,
} from '@/features/floor-plan/floorPlanQueries';
import { ResetCanvasDialog } from '@/features/floor-plan/ResetCanvasDialog';
import { RoomConnectorDialog } from '@/features/floor-plan/RoomConnectorDialog';
import { RoomDialog } from '@/features/floor-plan/RoomDialog';
import {
  useDeleteRoom,
  useDeleteRoomConnector,
  useRoomConnectors,
  useRooms,
  useUpsertRoom,
  useUpsertRoomConnector,
} from '@/features/floor-plan/roomQueries';
import type { ConnectorKind, RoomConnectorRow, RoomRow } from '@/features/floor-plan/roomTypes';
import { ScaleDialog } from '@/features/floor-plan/ScaleDialog';
import { ScaleFromBeaconsDialog } from '@/features/floor-plan/ScaleFromBeaconsDialog';
import { Toolbar } from '@/features/floor-plan/Toolbar';
import type {
  BeaconSprite,
  CalibrationPointSprite,
  FloorPlanCanvasHandle,
  FurnitureKind,
  RoomConnectorSprite,
  RoomSprite,
  SelectionDescriptor,
  ToolMode,
} from '@/features/floor-plan/types';
import { WallLengthDialog } from '@/features/floor-plan/WallLengthDialog';
import { BeaconsRail } from './BeaconsRail';
import { CalibrationRail } from './CalibrationRail';
import { FloorPlanRail } from './FloorPlanRail';
import { RoomsRail } from './RoomsRail';

// Two bundles instead of four sub-tabs: the spatial layout (floor plan +
// rooms + doors/windows, all in one editor) and the devices that live in
// it (beacons + calibration). Fewer destinations = less friction.
type PlaceSection = 'layout' | 'devices';
/** Within the devices bundle, which interaction the shared canvas is in. */
type DeviceMode = 'beacons' | 'calibration';

/** Map the URL param onto a bundle. Old 4-section bookmarks still resolve:
 *  floor-plan/rooms → layout, beacons/calibration → devices. */
function parseSection(raw: string): PlaceSection {
  if (raw === 'devices' || raw === 'beacons' || raw === 'calibration') return 'devices';
  return 'layout';
}

/** The canvas tool/mode a bundle drives. The layout bundle's mode is
 *  caregiver-controlled (via the toolbar); the devices bundle locks the
 *  geometry and switches between the placement / calibration interaction
 *  modes per the active device sub-mode. */
function sectionToMode(
  section: PlaceSection,
  drawMode: ToolMode,
  deviceMode: DeviceMode,
): ToolMode {
  if (section === 'devices') return deviceMode === 'beacons' ? 'beacon-placement' : 'calibration';
  return drawMode;
}

interface PlaceWorkspaceProps {
  patientId: string;
}

/** Unified Place workspace. One persistent FloorPlanCanvas serves every
 *  section — floor-plan drawing, beacon placement, room/door definition,
 *  and calibration capture — so the caregiver configures the whole space
 *  in one window without remounting the canvas (and losing zoom/pan) on
 *  every context switch. The active section flips the canvas's `editing`
 *  flag and mode and swaps the contextual rail. */
export function PlaceWorkspace({ patientId }: PlaceWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSection: PlaceSection = parseSection(searchParams.get('placeTab') ?? 'layout');
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('beacons');

  const setActiveSection = useCallback(
    (next: PlaceSection) => {
      setSearchParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          updated.set('placeTab', next);
          return updated;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ─── Queries ──────────────────────────────────────────────────────────
  const planQuery = useFloorPlan(patientId);
  const planId = planQuery.data?.id;
  const calibration = useCalibrationCount(planId);
  const upsert = useUpsertFloorPlan(patientId);
  const beaconsQuery = useBeacons(patientId);
  const updatePosition = useUpdateBeaconPosition(patientId);
  const deleteBeacon = useDeleteBeacon(patientId);
  const roomsQuery = useRooms(planId);
  const connectorsQuery = useRoomConnectors(planId);
  const upsertRoom = useUpsertRoom();
  const deleteRoom = useDeleteRoom();
  const upsertConnector = useUpsertRoomConnector();
  const deleteConnector = useDeleteRoomConnector();
  const pointsQuery = useCalibrationPoints(planId);
  const deletePoint = useDeleteCalibrationPoint(planId ?? '');

  // ─── Canvas + floor-plan editing state ──────────────────────────────────
  const canvasRef = useRef<FloorPlanCanvasHandle | null>(null);
  const [mode, setMode] = useState<ToolMode>('select');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [furnitureKind, setFurnitureKind] = useState<FurnitureKind>('bed');
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scale, setScale] = useState<number | null>(null);
  const [pathLossExponent, setPathLossExponent] = useState<number | null>(null);
  const [pathLossExponentDraft, setPathLossExponentDraft] = useState('');
  const [selection, setSelection] = useState<SelectionDescriptor>({ kind: 'none' });
  const [isEmpty, setIsEmpty] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [savedTone, setSavedTone] = useState<string | null>(null);
  const [remoteVersionPending, setRemoteVersionPending] = useState(false);
  const [pixelLength, setPixelLength] = useState<number | null>(null);
  const lastLoadedVersionRef = useRef<string | null>(null);

  // Floor-plan dialogs
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleFromBeaconsOpen, setScaleFromBeaconsOpen] = useState(false);
  const [wallLengthOpen, setWallLengthOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Rooms dialogs (add / edit / promote share one RoomDialog instance)
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    initial: RoomRow | null;
    seed: [number, number][] | null;
  }>({ open: false, initial: null, seed: null });
  // The connector dialog is now edit-only — adding doors/windows happens
  // by clicking on the canvas (the door/window tools). Editing an existing
  // connector still opens this to relabel / link rooms / nudge endpoints.
  const [connectorDialog, setConnectorDialog] = useState<{
    open: boolean;
    initial: RoomConnectorRow | null;
    presetKind: ConnectorKind;
  }>({ open: false, initial: null, presetKind: 'door' });

  // Beacons dialogs
  const [pairTarget, setPairTarget] = useState<string | null>(null);
  const [calibrationTarget, setCalibrationTarget] = useState<BeaconRow | null>(null);

  // Calibration capture pending spot
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);

  // Doors/windows drawn on the canvas but not yet written. They render on the
  // overlay immediately (optimistic) and are persisted to room_connectors as
  // part of the next plan Save — so a brand-new plan can have openings added
  // before it has an id, and "Save" covers the whole layout in one action.
  type DrawnConnector = {
    kind: 'door' | 'window';
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  const [pendingConnectors, setPendingConnectors] = useState<DrawnConnector[]>([]);

  const beacons = useMemo(() => beaconsQuery.data ?? [], [beaconsQuery.data]);
  const rooms = roomsQuery.data ?? [];
  const connectors = connectorsQuery.data ?? [];
  const points = useMemo(() => pointsQuery.data ?? [], [pointsQuery.data]);
  const plan = planQuery.data ?? null;
  const placementReady = plan != null && plan.scale_meters_per_pixel != null;
  // Beacon placement only writes canvas pixel coords, which don't need a
  // scale — so a drawn floor plan is enough to start dropping beacons. Scale
  // only matters later for converting RSSI → metres in F8 positioning, which
  // the rail nudges about separately. (Calibration still gates on scale.)
  const beaconPlacementReady = plan != null;
  const scaleSet = scale != null && scale > 0;
  const placedBeaconCount = beacons.filter(isPlaced).length;
  const pairedMacs = useMemo(() => new Set(beacons.map((b) => b.mac_address)), [beacons]);

  // ─── Hydrate plan-derived state ─────────────────────────────────────────
  useEffect(() => {
    setScale(planQuery.data?.scale_meters_per_pixel ?? null);
  }, [planQuery.data?.id, planQuery.data?.scale_meters_per_pixel]);

  useEffect(() => {
    const next = planQuery.data?.path_loss_exponent ?? null;
    setPathLossExponent(next);
    setPathLossExponentDraft(next == null ? '' : String(next));
  }, [planQuery.data?.id, planQuery.data?.path_loss_exponent]);

  // ─── Mirror addressable entities into the shared canvas overlays ────────
  useEffect(() => {
    const sprites: RoomSprite[] = (roomsQuery.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.room_type,
      polygon: r.polygon_canvas,
    }));
    canvasRef.current?.setRooms(sprites);
  }, [roomsQuery.data]);

  useEffect(() => {
    const saved: RoomConnectorSprite[] = (connectorsQuery.data ?? []).map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      start: { x: c.start_x, y: c.start_y },
      end: { x: c.end_x, y: c.end_y },
    }));
    // Merge unsaved draws so they show on the canvas before Save persists them.
    const drawn: RoomConnectorSprite[] = pendingConnectors.map((c, i) => ({
      id: `__pending-${i}`,
      kind: c.kind,
      label: null,
      start: c.start,
      end: c.end,
    }));
    canvasRef.current?.setRoomConnectors([...saved, ...drawn]);
  }, [connectorsQuery.data, pendingConnectors]);

  // All beacons (incl. unplaced) so an arm→drop flow doesn't need a refresh.
  // The canvas only renders them in beacon-placement / calibration modes.
  useEffect(() => {
    const sprites: BeaconSprite[] = beacons.map((b) => ({
      id: b.id,
      label: b.label ?? b.mac_address.slice(-5),
      x: b.x_canvas,
      y: b.y_canvas,
    }));
    canvasRef.current?.setBeacons(sprites);
  }, [beacons]);

  // Calibration points + the pending click spot.
  useEffect(() => {
    const placed: CalibrationPointSprite[] = points.map((p, i) => ({
      id: p.id,
      index: i + 1,
      x: p.x_canvas,
      y: p.y_canvas,
    }));
    const sprites = pending
      ? [
          ...placed,
          { id: '__pending', index: placed.length + 1, x: pending.x, y: pending.y, pending: true },
        ]
      : placed;
    canvasRef.current?.setCalibrationPoints(sprites);
  }, [points, pending]);

  // Arm capture only while the devices bundle is in calibration mode and
  // there's no pending spot waiting on Capture/Cancel.
  useEffect(() => {
    const calibrating = activeSection === 'devices' && deviceMode === 'calibration';
    canvasRef.current?.armCalibrationCapture(calibrating && pending == null);
  }, [activeSection, deviceMode, pending]);

  // ─── Drive canvas mode + editing from the active bundle ─────────────────
  // Runs on bundle / device-mode change; in-section drawing-mode switches
  // are handled imperatively by handleModeChange. modeRef avoids a stale
  // draw mode when returning to the layout bundle.
  useEffect(() => {
    canvasRef.current?.setMode(sectionToMode(activeSection, modeRef.current, deviceMode));
  }, [activeSection, deviceMode]);

  const canvasEditing = activeSection === 'layout' && editing;

  // ─── Reload canvas on a peer's save (unless we have unsaved edits) ──────
  useEffect(() => {
    const updated = planQuery.data?.updated_at;
    if (!updated) return;
    if (lastLoadedVersionRef.current === updated) return;
    if (lastLoadedVersionRef.current === null) {
      lastLoadedVersionRef.current = updated;
      return;
    }
    if (dirty) {
      setRemoteVersionPending(true);
      return;
    }
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json);
    lastLoadedVersionRef.current = updated;
    setRemoteVersionPending(false);
  }, [planQuery.data?.updated_at, planQuery.data?.canvas_json, dirty]);

  // ─── Floor-plan handlers ────────────────────────────────────────────────
  const handleModeChange = useCallback((next: ToolMode) => {
    setMode(next);
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

  const performSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const json = canvas.serialize();
    const result = await upsert.mutateAsync({
      id: planQuery.data?.id,
      patient_id: patientId,
      canvas_json: json,
      scale_meters_per_pixel: scale,
      path_loss_exponent: pathLossExponent,
    });
    // Persist any doors/windows drawn this session now that the plan has an
    // id (the upsert returns the row even on first create). They were held
    // pending so they save WITH the plan, not before it exists.
    const savedPlanId = (result as { id?: string }).id ?? planQuery.data?.id;
    if (savedPlanId && pendingConnectors.length > 0) {
      await Promise.all(
        pendingConnectors.map((c) =>
          upsertConnector.mutateAsync({
            patient_id: patientId,
            floor_plan_id: savedPlanId,
            kind: c.kind,
            start_x: Math.round(c.start.x),
            start_y: Math.round(c.start.y),
            end_x: Math.round(c.end.x),
            end_y: Math.round(c.end.y),
            room_a_id: null,
            room_b_id: null,
            label: null,
          }),
        ),
      );
      setPendingConnectors([]);
    }
    setDirty(false);
    setWarningOpen(false);
    setSavedTone(`Saved · ${new Date(result.updated_at).toLocaleTimeString()}`);
    lastLoadedVersionRef.current = result.updated_at;
    setRemoteVersionPending(false);
    setEditing(false);
  }, [
    patientId,
    planQuery.data?.id,
    scale,
    pathLossExponent,
    upsert,
    pendingConnectors,
    upsertConnector,
  ]);

  const handleSave = useCallback(() => {
    if (!dirty) return;
    if ((calibration.data ?? 0) > 0) setWarningOpen(true);
    else void performSave();
  }, [calibration.data, dirty, performSave]);

  const handlePathLossInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setPathLossExponentDraft(raw);
      if (raw.trim() === '') {
        if (pathLossExponent != null) {
          setPathLossExponent(null);
          setDirty(true);
          setSavedTone(null);
        }
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 1.0 || parsed > 6.0) return;
      if (parsed !== pathLossExponent) {
        setPathLossExponent(parsed);
        setDirty(true);
        setSavedTone(null);
      }
    },
    [pathLossExponent],
  );

  const pathLossExponentInputValid =
    pathLossExponentDraft.trim() === '' ||
    (Number.isFinite(Number(pathLossExponentDraft)) &&
      Number(pathLossExponentDraft) >= 1.0 &&
      Number(pathLossExponentDraft) <= 6.0);

  const handleSetScaleClick = useCallback(() => {
    setPixelLength(canvasRef.current?.getSelectedLinePixelLength() ?? null);
    setScaleOpen(true);
  }, []);

  const handleSetWallLengthClick = useCallback(() => {
    setPixelLength(canvasRef.current?.getSelectedLinePixelLength() ?? null);
    setWallLengthOpen(true);
  }, []);

  const handleScaleConfirmed = useCallback((next: number) => {
    setScale(next);
    setDirty(true);
  }, []);

  // Inline canvas editing: the caregiver types a real length (m) directly on
  // a wall or room-edge label; the plan recalibrates scale from that
  // segment's pixel length, rescaling every dimension + component size.
  const handleDimensionMetres = useCallback((pixelLength: number, metres: number) => {
    if (!Number.isFinite(pixelLength) || pixelLength <= 0) return;
    if (!Number.isFinite(metres) || metres <= 0) return;
    setScale(computeScale(pixelLength, metres));
    setDirty(true);
    setSavedTone(null);
  }, []);

  const handleWallLengthConfirmed = useCallback(
    (metres: number) => {
      if (scale == null) return;
      canvasRef.current?.setSelectedWallLength(metres, scale);
      setDirty(true);
    },
    [scale],
  );

  const handlePromotePolygonClick = useCallback(() => {
    const verts = canvasRef.current?.getSelectedPolygonVertices() ?? null;
    if (!verts || verts.length < 3 || planQuery.data == null) return;
    setRoomDialog({ open: true, initial: null, seed: verts });
  }, [planQuery.data]);

  // Arm a door/window tool from the rooms rail: enter edit mode and switch
  // the canvas into the placement tool so the next two clicks drop the
  // opening. Mirrors the toolbar Door/Window buttons.
  const handleStartConnectorTool = useCallback((kind: 'door' | 'window') => {
    setEditing(true);
    setMode(kind);
    canvasRef.current?.setMode(kind);
  }, []);

  // Queue a door/window drawn on the canvas. It renders immediately and is
  // written on the next Save (so it works on an unsaved plan, and Save covers
  // the whole layout). Label/room links can be added later by editing it.
  const handleConnectorDrawn = useCallback(
    (kind: 'door' | 'window', start: { x: number; y: number }, end: { x: number; y: number }) => {
      setPendingConnectors((prev) => [...prev, { kind, start, end }]);
      setDirty(true);
      setSavedTone(null);
    },
    [],
  );

  const handleDiscard = useCallback(() => {
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json ?? null);
    setPendingConnectors([]); // drop unsaved door/window draws
    setDirty(false);
    setEditing(false);
    setSavedTone(null);
  }, [planQuery.data?.canvas_json]);

  const handleAcceptRemote = useCallback(() => {
    void canvasRef.current?.deserialize(planQuery.data?.canvas_json);
    setDirty(false);
    setRemoteVersionPending(false);
    if (planQuery.data?.updated_at) lastLoadedVersionRef.current = planQuery.data.updated_at;
  }, [planQuery.data?.canvas_json, planQuery.data?.updated_at]);

  // ─── Beacon placement handlers ──────────────────────────────────────────
  const handlePlaceBeacon = useCallback(
    (id: string) => {
      // Ensure the devices bundle is in beacon-placement before the next
      // click lands. The armed id persists across the mode switch.
      setActiveSection('devices');
      setDeviceMode('beacons');
      canvasRef.current?.armPlacement(id);
    },
    [setActiveSection],
  );

  const handleBeaconUpdate = useCallback(
    (beaconId: string, x: number, y: number) => {
      updatePosition.mutate({ id: beaconId, x_canvas: x, y_canvas: y });
      canvasRef.current?.armPlacement(null);
    },
    [updatePosition],
  );

  // ─── Calibration handlers ───────────────────────────────────────────────
  const handleCalibrationClick = useCallback((x: number, y: number) => {
    setPending({ x, y });
  }, []);

  // ─── Loading / error gates ──────────────────────────────────────────────
  if (planQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
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
  const roomsError = roomsQuery.error || upsertRoom.error || deleteRoom.error;
  const connectorsError = connectorsQuery.error || upsertConnector.error || deleteConnector.error;
  const roomsRailError = (roomsError || connectorsError)?.message ?? null;

  return (
    <div className="space-y-3">
      <SectionSelector
        active={activeSection}
        onChange={setActiveSection}
        roomCount={rooms.length}
        beaconCount={placedBeaconCount}
      />

      {/* The active bundle's tools + canvas are the tab panel for the
          selected tab, so assistive tech announces the relationship. */}
      <div
        role="tabpanel"
        id="place-tabpanel"
        aria-labelledby={`place-tab-${activeSection}`}
        tabIndex={0}
        className="space-y-3 focus:outline-none"
      >
        {activeSection === 'layout' && (
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
            placedBeaconCount={placedBeaconCount}
            onModeChange={handleModeChange}
            onFurnitureKindChange={handleFurnitureKindChange}
            onSetScale={handleSetScaleClick}
            onSetScaleFromBeacons={() => setScaleFromBeaconsOpen(true)}
            onSetWallLength={handleSetWallLengthClick}
            onPromotePolygonToRoom={handlePromotePolygonClick}
            onSave={handleSave}
            onDelete={() => canvasRef.current?.deleteSelected()}
            onReset={() => setResetOpen(true)}
            canReset={!isEmpty}
            onUndo={() => canvasRef.current?.undo()}
            onRedo={() => canvasRef.current?.redo()}
            onFitToContent={() => canvasRef.current?.fitToContent()}
            onToggleDimensions={() => setShowDimensions((v) => !v)}
            onEdit={() => setEditing(true)}
            onDiscard={handleDiscard}
          />
        )}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative h-[calc(100vh-15rem)] min-h-[560px] w-full overflow-hidden rounded-lg border border-border bg-card">
            <FloorPlanCanvas
              ref={canvasRef}
              initialJson={initialJson}
              scale={scale}
              showDimensions={showDimensions}
              editing={canvasEditing}
              initialMode={sectionToMode(activeSection, mode, deviceMode)}
              onDirty={handleDirty}
              onModeChange={setMode}
              onIsEmptyChange={setIsEmpty}
              onSelectionChange={setSelection}
              onBeaconUpdate={handleBeaconUpdate}
              onCalibrationClick={handleCalibrationClick}
              onConnectorDrawn={handleConnectorDrawn}
              onDimensionCommit={handleDimensionMetres}
            />
            {activeSection === 'layout' && isEmpty && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="pointer-events-auto max-w-md">
                  <EmptyState
                    icon={<LayoutGrid className="h-10 w-10" />}
                    title="A blank canvas"
                    description={
                      editing
                        ? 'Draw outer walls (Wall tool), then Polygon to outline rooms — vertices snap to nearby wall ends. Draw a line across a doorway and click Door / window to place it. Shift locks ortho; Space pans; scroll zooms.'
                        : 'No floor plan yet. Click Edit in the toolbar to start drawing.'
                    }
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto lg:pr-1">
            {activeSection === 'layout' && (
              <>
                <FloorPlanRail
                  editing={editing}
                  scaleLabel={formatScale(scale)}
                  savedTone={savedTone}
                  remoteVersionPending={remoteVersionPending}
                  onAcceptRemote={handleAcceptRemote}
                  upsertError={upsert.isError ? (upsert.error as Error).message : null}
                  pathLossExponentDraft={pathLossExponentDraft}
                  pathLossExponentInputValid={pathLossExponentInputValid}
                  onPathLossInput={handlePathLossInput}
                />
                {/* Rooms + doors/windows live in the same editor — define them
                  here and they render live on the canvas overlay. */}
                <RoomsRail
                  rooms={rooms}
                  connectors={connectors}
                  roomsLoading={roomsQuery.isLoading}
                  connectorsLoading={connectorsQuery.isLoading}
                  deleteRoomPending={deleteRoom.isPending}
                  deleteConnectorPending={deleteConnector.isPending}
                  errorMessage={roomsRailError}
                  onAddRoom={() => setRoomDialog({ open: true, initial: null, seed: null })}
                  onEditRoom={(r) => setRoomDialog({ open: true, initial: r, seed: null })}
                  onDeleteRoom={(r) =>
                    deleteRoom.mutate({ id: r.id, floor_plan_id: r.floor_plan_id })
                  }
                  onAddConnector={(kind) => {
                    // The rail only offers door/window; openings are edit-only.
                    if (kind === 'door' || kind === 'window') handleStartConnectorTool(kind);
                  }}
                  onEditConnector={(c) =>
                    setConnectorDialog({ open: true, initial: c, presetKind: c.kind })
                  }
                  onDeleteConnector={(c) =>
                    deleteConnector.mutate({ id: c.id, floor_plan_id: c.floor_plan_id })
                  }
                />
              </>
            )}
            {activeSection === 'devices' && (
              <>
                <DeviceModeToggle value={deviceMode} onChange={setDeviceMode} />
                {deviceMode === 'beacons' ? (
                  <BeaconsRail
                    patientId={patientId}
                    beacons={beacons}
                    pairedMacs={pairedMacs}
                    placementReady={beaconPlacementReady}
                    scaleSet={scaleSet}
                    deletingId={
                      deleteBeacon.isPending ? (deleteBeacon.variables as string) : undefined
                    }
                    deleteError={
                      deleteBeacon.isError ? (deleteBeacon.error as Error).message : null
                    }
                    onPair={(mac) => setPairTarget(mac)}
                    onPlace={handlePlaceBeacon}
                    onCalibrate={(b) => setCalibrationTarget(b)}
                    onDelete={(id) => deleteBeacon.mutate(id)}
                  />
                ) : (
                  <CalibrationRail
                    floorPlanId={planId ?? null}
                    placementReady={placementReady}
                    planExists={plan != null}
                    points={points}
                    pending={pending}
                    deletingId={
                      deletePoint.isPending ? (deletePoint.variables as string) : undefined
                    }
                    deleteError={deletePoint.isError ? (deletePoint.error as Error).message : null}
                    onCaptureSuccess={() => setPending(null)}
                    onCaptureCancel={() => setPending(null)}
                    onDeletePoint={(id) => deletePoint.mutate(id)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Dialogs ───────────────────────────────────────────────────── */}
      <ScaleDialog
        open={scaleOpen}
        onOpenChange={setScaleOpen}
        pixelLength={pixelLength}
        onConfirm={handleScaleConfirmed}
      />
      <ScaleFromBeaconsDialog
        open={scaleFromBeaconsOpen}
        onOpenChange={setScaleFromBeaconsOpen}
        beacons={beacons}
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
        onConfirm={() => canvasRef.current?.clearAll()}
      />
      <CalibrationStaleWarning
        open={warningOpen}
        onOpenChange={setWarningOpen}
        calibrationCount={calibrationCount}
        saving={upsert.isPending}
        onConfirm={performSave}
      />

      {planId && (
        <>
          <RoomDialog
            open={roomDialog.open}
            onOpenChange={(open) => setRoomDialog((s) => ({ ...s, open }))}
            patientId={patientId}
            floorPlanId={planId}
            initial={roomDialog.initial}
            seedPolygon={roomDialog.seed ?? undefined}
            submitting={upsertRoom.isPending}
            onConfirm={async (input) => {
              await upsertRoom.mutateAsync(input);
            }}
          />
          <RoomConnectorDialog
            open={connectorDialog.open}
            onOpenChange={(open) => setConnectorDialog((s) => ({ ...s, open }))}
            patientId={patientId}
            floorPlanId={planId}
            rooms={rooms}
            initial={connectorDialog.initial}
            presetKind={connectorDialog.presetKind}
            submitting={upsertConnector.isPending}
            onConfirm={async (input) => {
              await upsertConnector.mutateAsync(input);
            }}
          />
        </>
      )}

      {pairTarget != null && (
        <PairDialog
          open
          onOpenChange={(open) => {
            if (!open) setPairTarget(null);
          }}
          mac={pairTarget}
          patientId={patientId}
          floorPlanId={planId ?? null}
        />
      )}
      <BeaconCalibrationDialog
        beacon={calibrationTarget}
        patientId={patientId}
        open={calibrationTarget != null}
        onOpenChange={(open) => {
          if (!open) setCalibrationTarget(null);
        }}
      />
    </div>
  );
}

interface SectionSelectorProps {
  active: PlaceSection;
  onChange: (next: PlaceSection) => void;
  roomCount: number;
  beaconCount: number;
}

/** Top-level bundle switch: two intuitive destinations rather than four
 *  sub-tabs. The space you draw, and the devices that live in it. */
function SectionSelector({ active, onChange, roomCount, beaconCount }: SectionSelectorProps) {
  const items: {
    key: PlaceSection;
    label: string;
    hint: string;
    icon: typeof LayoutGrid;
    badge?: number;
  }[] = [
    {
      key: 'layout',
      label: 'Floor plan & rooms',
      hint: 'Walls, rooms, doors & windows',
      icon: LayoutGrid,
      badge: roomCount,
    },
    {
      key: 'devices',
      label: 'Beacons & calibration',
      hint: 'Place beacons, capture fingerprints',
      icon: Bluetooth,
      badge: beaconCount,
    },
  ];
  const tabRefs = useRef<Partial<Record<PlaceSection, HTMLButtonElement | null>>>({});

  // WAI-ARIA tabs keyboard model: Left/Right (+ Up/Down) move between tabs
  // with selection following focus; Home/End jump to the ends. Only the
  // active tab is in the Tab order (roving tabindex).
  const onKeyDown = (e: KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    const nextKey = items[next]!.key;
    onChange(nextKey);
    tabRefs.current[nextKey]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Place configuration sections"
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
    >
      {items.map(({ key, label, hint, icon: Icon, badge }, index) => {
        const selected = active === key;
        return (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            id={`place-tab-${key}`}
            aria-selected={selected}
            aria-controls="place-tabpanel"
            tabIndex={selected ? 0 : -1}
            title={hint}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
            {badge != null && badge > 0 && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 text-[10px] tabular-nums',
                  selected ? 'bg-primary-foreground/20' : 'bg-muted-foreground/15',
                )}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface DeviceModeToggleProps {
  value: DeviceMode;
  onChange: (next: DeviceMode) => void;
}

/** Sub-switch inside the devices bundle: place beacons vs capture
 *  calibration fingerprints. Both act on the same canvas; this picks which
 *  interaction a click performs and which controls the rail shows. */
function DeviceModeToggle({ value, onChange }: DeviceModeToggleProps) {
  const items: { key: DeviceMode; label: string; icon: typeof Bluetooth }[] = [
    { key: 'beacons', label: 'Place beacons', icon: Bluetooth },
    { key: 'calibration', label: 'Calibrate', icon: Target },
  ];
  return (
    <div
      role="group"
      aria-label="Device tool: place beacons or calibrate"
      className="flex gap-1 rounded-md border border-border bg-muted/40 p-1"
    >
      {items.map(({ key, label, icon: Icon }) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
