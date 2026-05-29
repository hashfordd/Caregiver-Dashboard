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
  /** Door / window placement: click-to-place a connector segment in the
   *  floor-plan editor (click start, click end). On finish the canvas
   *  fires onConnectorDrawn; the workspace persists it to room_connectors
   *  and it renders via the SVG overlay (not stored in canvas_json). */
  | 'door'
  | 'window'
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
  /** Per-edge pixel lengths of the selected polygon room, in vertex order,
   *  when kind === 'polygon'. Lets the caller calibrate scale from a known
   *  room wall without the edges being individually selectable objects. */
  edgeLengthsPx?: number[];
  /** Number of objects, when kind === 'multi'. */
  count?: number;
}

export interface FloorPlanRow {
  id: string;
  patient_id: string;
  name: string;
  canvas_json: unknown;
  scale_meters_per_pixel: number | null;
  /** Log-distance path-loss exponent used by F8. Null → estimator falls
   *  back to DEFAULT_PATH_LOSS_EXPONENT (2.0). Range enforced [1.0, 6.0]
   *  by a DB check constraint. */
  path_loss_exponent: number | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface UpsertFloorPlanInput {
  id?: string;
  patient_id: string;
  canvas_json: unknown;
  scale_meters_per_pixel: number | null;
  /** Null clears the override and reverts to the code default. */
  path_loss_exponent: number | null;
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
  /** F8: render or clear the live patient marker. Pass null to hide
   *  (e.g. when the patient is in outdoor mode, or no estimate yet).
   *  The canvas owns a single marker DOM node that's repositioned in
   *  place — no create/destroy churn at 1 Hz. */
  setPatientMarker: (sprite: PatientMarkerSprite | null) => void;
  /** F13: replace the replay trail with the given dot sprites. The
   *  canvas diffs against the currently-rendered set: dots in the
   *  previous render that are absent from `sprites` are explicitly
   *  removed; new dots are added. Pass an empty array to clear the
   *  trail entirely (end of replay or scrub-to-start). */
  setReplayDots: (sprites: ReplayDotSprite[]) => void;
  /** Phase B: replace the rendered room polygons with the given list.
   *  Polygons render as tinted filled outlines plus a centred name
   *  label in a dedicated SVG overlay, sitting above the Fabric layer
   *  and below the patient marker. Pass an empty array to clear. */
  setRooms: (sprites: RoomSprite[]) => void;
  /** Phase B: replace the rendered door / window / opening segments.
   *  Doors render as dashed thick lines, windows as solid thin lines,
   *  openings as dotted lines. Same SVG overlay as setRooms. */
  setRoomConnectors: (sprites: RoomConnectorSprite[]) => void;
  /** Phase B polish: extract the world-coord vertices of the currently
   *  selected Fabric polygon, in caregiver-drawing order. Returns null
   *  when nothing is selected or the selection isn't a polygon. Used by
   *  "Promote to room" to seed the RoomDialog without making the
   *  caregiver retype vertices. */
  getSelectedPolygonVertices: () => [number, number][] | null;
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
  /** Live RSSI (dBm) from the discovered-beacons store, when heard. */
  rssi?: number | null;
  /** Beacon battery %, when advertised. */
  battery?: number | null;
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

/** F8 patient marker — the live position dot. `confidence` is bound to
 *  the marker's opacity (clamped to a minimum visible value). */
export interface PatientMarkerSprite {
  x: number;
  y: number;
  /** 0..1 from `position_estimates.confidence`. */
  confidence: number;
  /** ISO 8601, surfaced in the marker tooltip so the caregiver can see
   *  how stale the latest estimate is. */
  recorded_at: string;
  /** Item 94: when true, the marker renders an amber stale ring (parity
   *  with map/PatientPin). Set by LivePositionView when the latest
   *  estimate is older than 30 s. */
  isStale?: boolean;
}

/** F13 replay trail dot. Each rendered row in the position history
 *  becomes one dot; the scrubber removes dots that fall outside the
 *  60 s trail window via canvas.remove to prevent object accumulation. */
export interface ReplayDotSprite {
  /** Unique key so the canvas can find and remove a specific dot. */
  key: string;
  x: number;
  y: number;
  /** 0..1 — dots earlier in the trail render at lower opacity. */
  alpha: number;
}

/** Phase B room overlay. Distinct from the DB shape so the canvas
 *  doesn't depend on the rooms feature module — same separation as
 *  BeaconSprite vs BeaconRow. World coords throughout; the canvas
 *  applies screenFromWorld at render time. */
export interface RoomSprite {
  id: string;
  name: string;
  /** Drives the fill colour palette in the overlay so rooms of the
   *  same kind render consistently. */
  roomType:
    | 'bedroom'
    | 'bathroom'
    | 'kitchen'
    | 'living_room'
    | 'dining_room'
    | 'hallway'
    | 'other';
  /** Polygon vertices in world (canvas-pixel) coordinates. Implicit
   *  closure — the canvas does not require repeating the first vertex. */
  polygon: [number, number][];
}

/** Phase B door / window / opening overlay. Line segment in world
 *  coords; the canvas styles it by kind (door: dashed thick, window:
 *  solid thin, opening: dotted). */
export interface RoomConnectorSprite {
  id: string;
  kind: 'door' | 'window' | 'opening';
  /** Optional human label rendered next to the segment. */
  label: string | null;
  start: { x: number; y: number };
  end: { x: number; y: number };
}
