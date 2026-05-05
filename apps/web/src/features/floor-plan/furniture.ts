import * as fabric from 'fabric';
import {
  Armchair,
  Bath,
  Bed,
  BookOpen,
  Droplets,
  Lamp,
  Sofa,
  ShowerHead,
  Square,
  Tv,
  Utensils,
} from 'lucide-react';
import type { FurnitureKind } from './types';

const STROKE = '#3e5c76';
const FURNITURE_FILL = 'rgba(116, 140, 171, 0.18)';

interface FurnitureSpec {
  label: string;
  icon: typeof Bed;
  realSize: { w: number; h: number };
  fallbackPx: { w: number; h: number };
}

// Real-world default footprints in metres. Used whenever the floor plan has
// a scale set, so a bed in a small bedroom reads as a bed not a sleeping
// bag. Fallback pixel sizes are roughly proportional at 1px = 2cm so the
// caregiver still sees believable shapes before they set a scale.
const FURNITURE: Record<FurnitureKind, FurnitureSpec> = {
  bed: {
    label: 'Double bed',
    icon: Bed,
    realSize: { w: 1.4, h: 2.0 },
    fallbackPx: { w: 70, h: 100 },
  },
  singleBed: {
    label: 'Single bed',
    icon: Bed,
    realSize: { w: 0.9, h: 1.9 },
    fallbackPx: { w: 45, h: 95 },
  },
  sofa: {
    label: 'Sofa',
    icon: Sofa,
    realSize: { w: 2.0, h: 0.9 },
    fallbackPx: { w: 100, h: 45 },
  },
  chair: {
    label: 'Chair',
    icon: Armchair,
    realSize: { w: 0.5, h: 0.5 },
    fallbackPx: { w: 25, h: 25 },
  },
  table: {
    label: 'Dining table',
    icon: Utensils,
    realSize: { w: 1.6, h: 0.9 },
    fallbackPx: { w: 80, h: 45 },
  },
  desk: {
    label: 'Desk',
    icon: BookOpen,
    realSize: { w: 1.2, h: 0.6 },
    fallbackPx: { w: 60, h: 30 },
  },
  wardrobe: {
    label: 'Wardrobe',
    icon: Lamp,
    realSize: { w: 1.5, h: 0.6 },
    fallbackPx: { w: 75, h: 30 },
  },
  tv: {
    label: 'TV / cabinet',
    icon: Tv,
    realSize: { w: 1.4, h: 0.4 },
    fallbackPx: { w: 70, h: 20 },
  },
  toilet: {
    label: 'Toilet',
    icon: Square,
    realSize: { w: 0.6, h: 0.7 },
    fallbackPx: { w: 30, h: 35 },
  },
  sink: {
    label: 'Sink',
    icon: Droplets,
    realSize: { w: 0.6, h: 0.45 },
    fallbackPx: { w: 30, h: 22 },
  },
  bath: {
    label: 'Bath',
    icon: Bath,
    realSize: { w: 1.7, h: 0.75 },
    fallbackPx: { w: 85, h: 38 },
  },
  shower: {
    label: 'Shower',
    icon: ShowerHead,
    realSize: { w: 0.9, h: 0.9 },
    fallbackPx: { w: 45, h: 45 },
  },
};

export const FURNITURE_KINDS: FurnitureKind[] = [
  'bed',
  'singleBed',
  'sofa',
  'chair',
  'table',
  'desk',
  'wardrobe',
  'tv',
  'toilet',
  'sink',
  'bath',
  'shower',
];

export function furnitureLabel(kind: FurnitureKind): string {
  return FURNITURE[kind].label;
}

export function furnitureIcon(kind: FurnitureKind): typeof Bed {
  return FURNITURE[kind].icon;
}

export function addFurnitureAt(
  canvas: fabric.Canvas,
  point: { x: number; y: number },
  kind: FurnitureKind,
  scaleMetersPerPixel: number | null,
  snapValue: (v: number) => number,
): fabric.Group {
  const spec = FURNITURE[kind];
  let w: number;
  let h: number;
  if (
    scaleMetersPerPixel != null &&
    Number.isFinite(scaleMetersPerPixel) &&
    scaleMetersPerPixel > 0
  ) {
    w = spec.realSize.w / scaleMetersPerPixel;
    h = spec.realSize.h / scaleMetersPerPixel;
  } else {
    ({ w, h } = spec.fallbackPx);
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
  const text = new fabric.IText(spec.label, {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: Math.max(10, Math.min(14, w / 6)),
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
