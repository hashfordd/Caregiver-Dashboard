import * as fabric from 'fabric';
import type { FurnitureKind } from './types';

const STROKE = '#3e5c76';
const FURNITURE_FILL = 'rgba(116, 140, 171, 0.18)';

const LABELS: Record<FurnitureKind, string> = {
  bed: 'Bed',
  chair: 'Chair',
  table: 'Table',
  toilet: 'Toilet',
  kitchen: 'Kitchen',
};

// Real-world default footprint in metres. Used whenever the floor plan has
// a scale set so a bed in a small room reads as a bed, not a sleeping bag.
const REAL_SIZE_M: Record<FurnitureKind, { w: number; h: number }> = {
  bed: { w: 1.4, h: 2.0 },
  chair: { w: 0.5, h: 0.5 },
  table: { w: 1.2, h: 0.8 },
  toilet: { w: 0.6, h: 0.8 },
  kitchen: { w: 1.8, h: 0.7 },
};

// Fallback sizes (in canvas pixels) used while the caregiver hasn't set a
// scale yet. Roughly proportional to the real-world sizes at 1px = 2cm.
const FALLBACK_PX: Record<FurnitureKind, { w: number; h: number }> = {
  bed: { w: 70, h: 100 },
  chair: { w: 25, h: 25 },
  table: { w: 60, h: 40 },
  toilet: { w: 30, h: 40 },
  kitchen: { w: 90, h: 35 },
};

export function addFurnitureAt(
  canvas: fabric.Canvas,
  point: { x: number; y: number },
  kind: FurnitureKind,
  scaleMetersPerPixel: number | null,
  snapValue: (v: number) => number,
): fabric.Group {
  let w: number;
  let h: number;
  if (
    scaleMetersPerPixel != null &&
    Number.isFinite(scaleMetersPerPixel) &&
    scaleMetersPerPixel > 0
  ) {
    w = REAL_SIZE_M[kind].w / scaleMetersPerPixel;
    h = REAL_SIZE_M[kind].h / scaleMetersPerPixel;
  } else {
    ({ w, h } = FALLBACK_PX[kind]);
  }
  const rect = new fabric.Rect({
    width: w,
    height: h,
    fill: FURNITURE_FILL,
    stroke: STROKE,
    strokeWidth: 1.5,
    rx: 4,
    ry: 4,
    originX: 'center',
    originY: 'center',
  });
  const text = new fabric.IText(LABELS[kind], {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: Math.max(10, Math.min(16, w / 6)),
    fill: STROKE,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
  });
  const group = new fabric.Group([rect, text], {
    left: snapValue(point.x),
    top: snapValue(point.y),
    originX: 'center',
    originY: 'center',
  });
  (group as unknown as { __fpKind?: string }).__fpKind = 'furniture';
  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.requestRenderAll();
  return group;
}
