import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as fabric from 'fabric';
import { cn } from '@/lib/utils';
import type { FloorPlanCanvasHandle, FurnitureKind, ToolMode } from './types';

interface FloorPlanCanvasProps {
  initialJson: unknown;
  onDirty?: () => void;
  width?: number;
  height?: number;
  className?: string;
}

const FURNITURE_PRESETS: Record<FurnitureKind, { label: string; w: number; h: number }> = {
  bed: { label: 'Bed', w: 120, h: 180 },
  chair: { label: 'Chair', w: 50, h: 50 },
  table: { label: 'Table', w: 110, h: 70 },
  toilet: { label: 'Toilet', w: 60, h: 80 },
  kitchen: { label: 'Kitchen', w: 160, h: 70 },
};

const STROKE = '#3e5c76';
const FURNITURE_FILL = 'rgba(116, 140, 171, 0.18)';
const ROOM_FILL = 'rgba(116, 140, 171, 0.06)';

function tagged(obj: fabric.Object, kind: 'wall' | 'room' | 'furniture'): void {
  (obj as unknown as { __fpKind?: string }).__fpKind = kind;
}

function kindOf(obj: fabric.Object): string | undefined {
  return (obj as unknown as { __fpKind?: string }).__fpKind;
}

export const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, FloorPlanCanvasProps>(
  function FloorPlanCanvas({ initialJson, onDirty, width = 960, height = 600, className }, ref) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const modeRef = useRef<ToolMode>('select');
    const furnitureKindRef = useRef<FurnitureKind>('bed');
    const drawingRef = useRef<{
      kind: 'wall' | 'room';
      object: fabric.Line | fabric.Rect;
      origin: { x: number; y: number };
    } | null>(null);

    useEffect(() => {
      if (!canvasElRef.current) return;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width,
        height,
        backgroundColor: 'transparent',
        selection: true,
      });
      fabricRef.current = canvas;

      const markDirty = () => onDirty?.();

      const handlePointerDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        const mode = modeRef.current;
        if (mode === 'select') return;
        const target = canvas.findTarget(opt.e);
        if (target && mode !== 'furniture') {
          // Let users click existing objects in wall/room modes too
          // (Fabric will move into selection mode on its own).
          return;
        }
        const p = canvas.getScenePoint(opt.e);
        if (mode === 'wall') {
          const line = new fabric.Line([p.x, p.y, p.x, p.y], {
            stroke: STROKE,
            strokeWidth: 4,
            strokeLineCap: 'round',
            selectable: false,
            evented: false,
          });
          tagged(line, 'wall');
          canvas.add(line);
          drawingRef.current = { kind: 'wall', object: line, origin: { x: p.x, y: p.y } };
        } else if (mode === 'room') {
          const rect = new fabric.Rect({
            left: p.x,
            top: p.y,
            width: 1,
            height: 1,
            fill: ROOM_FILL,
            stroke: STROKE,
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
          tagged(rect, 'room');
          canvas.add(rect);
          drawingRef.current = { kind: 'room', object: rect, origin: { x: p.x, y: p.y } };
        } else if (mode === 'furniture') {
          addFurnitureAt(canvas, p, furnitureKindRef.current);
          markDirty();
          modeRef.current = 'select';
          canvas.selection = true;
        }
      };

      const handlePointerMove = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        const draft = drawingRef.current;
        if (!draft) return;
        const p = canvas.getScenePoint(opt.e);
        if (draft.kind === 'wall') {
          (draft.object as fabric.Line).set({ x2: p.x, y2: p.y });
        } else {
          const rect = draft.object as fabric.Rect;
          rect.set({
            left: Math.min(p.x, draft.origin.x),
            top: Math.min(p.y, draft.origin.y),
            width: Math.abs(p.x - draft.origin.x),
            height: Math.abs(p.y - draft.origin.y),
          });
        }
        canvas.requestRenderAll();
      };

      const handlePointerUp = () => {
        const draft = drawingRef.current;
        if (!draft) return;
        draft.object.set({ selectable: true, evented: true });
        canvas.setActiveObject(draft.object);
        markDirty();
        drawingRef.current = null;
        // Snap back to select mode after each draw stroke for ergonomics.
        modeRef.current = 'select';
        canvas.selection = true;
      };

      canvas.on('mouse:down', handlePointerDown);
      canvas.on('mouse:move', handlePointerMove);
      canvas.on('mouse:up', handlePointerUp);
      canvas.on('object:modified', markDirty);
      canvas.on('object:added', markDirty);
      canvas.on('object:removed', markDirty);

      if (initialJson && typeof initialJson === 'object') {
        canvas
          .loadFromJSON(initialJson as Record<string, unknown>)
          .then(() => canvas.renderAll())
          .catch((err) => console.error('floor-plan: loadFromJSON failed', err));
      }

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const obj = canvas.getActiveObject();
        if (!obj) return;
        canvas.remove(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        markDirty();
      };
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        canvas.dispose();
        fabricRef.current = null;
      };
      // initialJson deliberately not in deps — load once on mount; deserialize
      // imperative API rehydrates if the parent needs to.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height, onDirty]);

    useImperativeHandle(
      ref,
      () => ({
        setMode: (mode, kind) => {
          modeRef.current = mode;
          if (kind) furnitureKindRef.current = kind;
          const canvas = fabricRef.current;
          if (canvas) canvas.selection = mode === 'select';
        },
        setFurnitureKind: (kind) => {
          furnitureKindRef.current = kind;
        },
        serialize: () => fabricRef.current?.toJSON() ?? null,
        deserialize: async (data) => {
          const canvas = fabricRef.current;
          if (!canvas || !data || typeof data !== 'object') return;
          await canvas.loadFromJSON(data as Record<string, unknown>);
          canvas.renderAll();
        },
        getSelectedLinePixelLength: () => {
          const canvas = fabricRef.current;
          const obj = canvas?.getActiveObject();
          if (!obj || !(obj instanceof fabric.Line)) return null;
          const x1 = obj.x1 ?? 0;
          const y1 = obj.y1 ?? 0;
          const x2 = obj.x2 ?? 0;
          const y2 = obj.y2 ?? 0;
          return Math.hypot(x2 - x1, y2 - y1);
        },
        deleteSelected: () => {
          const canvas = fabricRef.current;
          const obj = canvas?.getActiveObject();
          if (!canvas || !obj) return;
          canvas.remove(obj);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
        },
        countObjects: () => {
          const canvas = fabricRef.current;
          const result = { walls: 0, rooms: 0, furniture: 0 };
          if (!canvas) return result;
          for (const obj of canvas.getObjects()) {
            const k = kindOf(obj);
            if (k === 'wall') result.walls += 1;
            else if (k === 'room') result.rooms += 1;
            else if (k === 'furniture') result.furniture += 1;
          }
          return result;
        },
      }),
      [],
    );

    return (
      <div className={cn('overflow-auto rounded-lg border border-border bg-card', className)}>
        <canvas ref={canvasElRef} width={width} height={height} />
      </div>
    );
  },
);

function addFurnitureAt(
  canvas: fabric.Canvas,
  point: { x: number; y: number },
  kind: FurnitureKind,
): void {
  const preset = FURNITURE_PRESETS[kind];
  const rect = new fabric.Rect({
    width: preset.w,
    height: preset.h,
    fill: FURNITURE_FILL,
    stroke: STROKE,
    strokeWidth: 1.5,
    rx: 4,
    ry: 4,
    originX: 'center',
    originY: 'center',
  });
  const text = new fabric.IText(preset.label, {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 14,
    fill: STROKE,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
  });
  const group = new fabric.Group([rect, text], {
    left: point.x,
    top: point.y,
    originX: 'center',
    originY: 'center',
  });
  tagged(group, 'furniture');
  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.requestRenderAll();
}
