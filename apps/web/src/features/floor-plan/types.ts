// Local types for the F5 floor plan editor. Decorative geometry (walls,
// rooms, doors, furniture) lives in `floor_plans.canvas_json` as opaque
// Fabric output (per CROSS_CUTTING §6); addressable entities (beacons,
// calibration points) are owned by F6 / F7 in their own tables.

export type ToolMode = 'select' | 'wall' | 'room' | 'furniture';

export type FurnitureKind = 'bed' | 'chair' | 'table' | 'toilet' | 'kitchen';

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
  countObjects: () => { walls: number; rooms: number; furniture: number };
}
