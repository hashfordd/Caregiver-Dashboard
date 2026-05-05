// Local types for the F5 floor plan editor. Decorative geometry (walls,
// rooms, doors, furniture) lives in `floor_plans.canvas_json` as opaque
// Fabric output (per CROSS_CUTTING §6); addressable entities (beacons,
// calibration points) are owned by F6 / F7 in their own tables.

export type ToolMode =
  | 'select'
  | 'wall'
  | 'room'
  | 'polygon'
  | 'furniture'
  /** F6 beacon placement: every wall/room/furniture object is locked
   *  read-only, the F5 keyboard shortcuts are gated off, and click events
   *  on the canvas only matter when a beacon has been armed for
   *  placement. The Beacons sub-tab is the only entry point. */
  | 'beacon-placement'
  /** F7 calibration capture: walls/rooms/furniture AND placed beacons are
   *  locked read-only (beacons render as visual context but are
   *  non-draggable). A click on the canvas while armed sets the pending
   *  calibration spot; the Capture button starts the 5–10 s window. The
   *  Calibration sub-tab is the only entry point. */
  | 'calibration';

export type FurnitureKind =
  | 'bed'
  | 'singleBed'
  | 'sofa'
  | 'chair'
  | 'table'
  | 'desk'
  | 'wardrobe'
  | 'tv'
  | 'toilet'
  | 'sink'
  | 'bath'
  | 'shower';

/** Snapshot of the current Fabric selection — surfaced to the editor so it
 *  can enable/disable toolbar actions like Set scale or Set length without
 *  reaching into Fabric internals. */
export interface SelectionDescriptor {
  kind: 'none' | 'wall' | 'room' | 'polygon' | 'furniture' | 'multi';
  /** Pixel length of the selected line, when kind === 'wall'. */
  pixelLength?: number;
  /** Number of objects, when kind === 'multi'. */
  count?: number;
}

export interface FloorPlanRow {
  id: string;
  patient_id: string;
  name: string;
  canvas_json: unknown;
  scale_meters_per_pixel: number | null;
  created_at: string;
}

export interface UpsertFloorPlanInput {
  id?: string;
  patient_id: string;
  canvas_json: unknown;
  scale_meters_per_pixel: number | null;
  name?: string;
}

export interface FloorPlanCanvasHandle {
  setMode: (mode: ToolMode, kind?: FurnitureKind) => void;
  setFurnitureKind: (kind: FurnitureKind) => void;
  serialize: () => unknown;
  deserialize: (data: unknown) => Promise<void>;
  getSelectedLinePixelLength: () => number | null;
  deleteSelected: () => void;
  /** Wipe every wall, room, and furniture object in one shot. Pushes a
   *  history snapshot so the action is undoable. No-op when not editing. */
  clearAll: () => void;
  countObjects: () => { walls: number; rooms: number; furniture: number };
  undo: () => void;
  redo: () => void;
  fitToContent: () => void;
  /** Resize the currently-selected wall to the given length in metres,
   *  preserving its angle and start endpoint. No-op if no wall is
   *  selected, or if scale is null. */
  setSelectedWallLength: (metres: number, scaleMetersPerPixel: number) => void;
  /** F6: replace the rendered beacon overlay with the given list. The
   *  canvas keeps its own DOM layer for beacons (mirroring how F5
   *  renders join indicators) so they ride along with zoom/pan via
   *  screenFromWorld. Sprites with null x/y are kept in the list but
   *  not rendered until they're armed and placed. */
  setBeacons: (sprites: BeaconSprite[]) => void;
  /** F6: arm a beacon for placement. The next click on the canvas drops
   *  it at the click coords (snapped to grid). Pass null to disarm. */
  armPlacement: (beaconId: string | null) => void;
  /** F7: replace the rendered calibration-points overlay with the given
   *  list. Same pattern as setBeacons — DOM layer, screenFromWorld,
   *  rides zoom/pan. Sprites with `pending: true` render with a dashed
   *  outline and lower opacity to convey "not yet captured". */
  setCalibrationPoints: (sprites: CalibrationPointSprite[]) => void;
  /** F7: arm/disarm calibration capture. When armed, the next click on
   *  the canvas fires onCalibrationClick (the panel sets the pending
   *  spot). Pass false to disarm. */
  armCalibrationCapture: (armed: boolean) => void;
}

/** A beacon as the canvas needs to render it — id, label for tooltip,
 *  and world coordinates. Distinct from BeaconRow (the DB shape) so the
 *  canvas doesn't depend on the F6 feature module. */
export interface BeaconSprite {
  id: string;
  label: string;
  /** Null until the beacon has been placed — unplaced beacons live in
   *  the side panel only, not on the canvas. */
  x: number | null;
  y: number | null;
}

/** A calibration point as the canvas needs to render it. Index is
 *  derived panel-side from `captured_at` ordering — never persisted on
 *  the row. `pending: true` distinguishes the click-to-mark spot before
 *  Capture is pressed from already-written points. */
export interface CalibrationPointSprite {
  id: string;
  index: number;
  x: number;
  y: number;
  pending?: boolean;
}
