// Local types for the F5 floor plan editor. Decorative geometry (walls,
// rooms, doors, furniture) lives in `floor_plans.canvas_json` as opaque
// Fabric output (per CROSS_CUTTING §6); addressable entities (beacons,
// calibration points) are owned by F6 / F7 in their own tables.

export type ToolMode = 'select' | 'wall' | 'room' | 'polygon' | 'furniture';

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
}
