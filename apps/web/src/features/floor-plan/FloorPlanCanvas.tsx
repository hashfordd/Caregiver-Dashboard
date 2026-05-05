import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as fabric from 'fabric';
import { cn } from '@/lib/utils';
import type { FloorPlanCanvasHandle, FurnitureKind, ToolMode } from './types';

interface FloorPlanCanvasProps {
  initialJson: unknown;
  scale: number | null;
  onDirty?: () => void;
  onModeChange?: (next: ToolMode) => void;
  onIsEmptyChange?: (isEmpty: boolean) => void;
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

const GRID_SIZE = 20;
const HISTORY_LIMIT = 50;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
// Custom properties we want preserved across canvas.toObject / loadFromJSON.
// Fabric's allow-list excludes anything starting with __, so the kind tags
// would otherwise vanish on the first save/reload — breaking countObjects().
const EXTRA_PROPS = ['__fpKind'];

function tagged(obj: fabric.Object, kind: 'wall' | 'room' | 'furniture'): void {
  (obj as unknown as { __fpKind?: string }).__fpKind = kind;
}

function kindOf(obj: fabric.Object): string | undefined {
  return (obj as unknown as { __fpKind?: string }).__fpKind;
}

function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, FloorPlanCanvasProps>(
  function FloorPlanCanvas(
    {
      initialJson,
      scale,
      onDirty,
      onModeChange,
      onIsEmptyChange,
      width = 960,
      height = 600,
      className,
    },
    ref,
  ) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const hudRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);

    const modeRef = useRef<ToolMode>('select');
    const furnitureKindRef = useRef<FurnitureKind>('bed');
    const drawingRef = useRef<{
      kind: 'wall' | 'room';
      object: fabric.Line | fabric.Rect;
      origin: { x: number; y: number };
    } | null>(null);

    // Stable refs for callbacks/data so changes don't re-mount the canvas.
    const onDirtyRef = useRef(onDirty);
    const onModeChangeRef = useRef(onModeChange);
    const onIsEmptyChangeRef = useRef(onIsEmptyChange);
    const scaleRef = useRef(scale);

    const interactiveRef = useRef(false);
    const replayingRef = useRef(false);
    const spaceHeldRef = useRef(false);
    const panningRef = useRef(false);
    const panOriginRef = useRef<{ x: number; y: number } | null>(null);

    // Linear history: stack of serialised states; idx is the current entry.
    const historyRef = useRef<{ stack: unknown[]; idx: number }>({ stack: [], idx: -1 });

    useEffect(() => {
      onDirtyRef.current = onDirty;
    }, [onDirty]);
    useEffect(() => {
      onModeChangeRef.current = onModeChange;
    }, [onModeChange]);
    useEffect(() => {
      onIsEmptyChangeRef.current = onIsEmptyChange;
    }, [onIsEmptyChange]);
    useEffect(() => {
      scaleRef.current = scale;
    }, [scale]);

    useEffect(() => {
      if (!canvasElRef.current) return;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width,
        height,
        backgroundColor: 'transparent',
        selection: true,
        fireRightClick: false,
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      // ─── Helpers ────────────────────────────────────────────────────────
      const modeCursor = () => (modeRef.current === 'select' ? 'default' : 'crosshair');

      const autoRevertToSelect = () => {
        modeRef.current = 'select';
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        onModeChangeRef.current?.('select');
      };

      const emitDirty = () => {
        if (!interactiveRef.current || replayingRef.current) return;
        onDirtyRef.current?.();
      };

      const emitEmpty = () => {
        onIsEmptyChangeRef.current?.(canvas.getObjects().length === 0);
      };

      const snapshot = () => {
        if (!interactiveRef.current || replayingRef.current) return;
        const state = canvas.toObject(EXTRA_PROPS);
        const h = historyRef.current;
        if (h.idx < h.stack.length - 1) {
          h.stack = h.stack.slice(0, h.idx + 1);
        }
        h.stack.push(state);
        if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
        h.idx = h.stack.length - 1;
      };

      const replay = (state: unknown) => {
        replayingRef.current = true;
        canvas
          .loadFromJSON(state as Record<string, unknown>)
          .then(() => {
            backfillKinds(canvas, state);
            canvas.renderAll();
            replayingRef.current = false;
            onDirtyRef.current?.();
            emitEmpty();
            updateGrid();
          })
          .catch((err) => {
            console.error('floor-plan: replay failed', err);
            replayingRef.current = false;
          });
      };

      const undo = () => {
        if (drawingRef.current) return;
        const h = historyRef.current;
        if (h.idx <= 0) return;
        h.idx -= 1;
        replay(h.stack[h.idx]);
      };

      const redo = () => {
        if (drawingRef.current) return;
        const h = historyRef.current;
        if (h.idx >= h.stack.length - 1) return;
        h.idx += 1;
        replay(h.stack[h.idx]);
      };

      // Stash undo/redo on the canvas for the imperative handle.
      Object.assign(canvas as unknown as Record<string, unknown>, {
        __fpUndo: undo,
        __fpRedo: redo,
      });

      const formatLength = (px: number): string => {
        const s = scaleRef.current;
        if (s != null && Number.isFinite(s) && s > 0) {
          const m = px * s;
          return m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(0)} cm`;
        }
        return `${Math.round(px)} px`;
      };

      const setHud = (left: number | null, top?: number, label?: string) => {
        const el = hudRef.current;
        if (!el) return;
        if (left == null) {
          el.style.display = 'none';
          return;
        }
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top ?? 0}px`;
        el.textContent = label ?? '';
      };

      const updateGrid = () => {
        const grid = gridRef.current;
        const vt = canvas.viewportTransform;
        if (!grid || !vt) return;
        const z = vt[0];
        const tx = vt[4];
        const ty = vt[5];
        const size = GRID_SIZE * z;
        grid.style.backgroundSize = `${size}px ${size}px`;
        grid.style.backgroundPosition = `${tx}px ${ty}px`;
      };

      const screenFromMouse = (e: MouseEvent) => {
        const rect = canvas.upperCanvasEl.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      // ─── Pointer handlers ───────────────────────────────────────────────
      const handlePointerDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        if (!interactiveRef.current) return;
        const e = opt.e as MouseEvent;

        // Pan via held space — overrides any draw mode.
        if (spaceHeldRef.current) {
          panningRef.current = true;
          panOriginRef.current = { x: e.clientX, y: e.clientY };
          canvas.setCursor('grabbing');
          return;
        }

        const mode = modeRef.current;
        if (mode === 'select') return;

        const raw = canvas.getScenePoint(opt.e);
        const sp = { x: snap(raw.x), y: snap(raw.y) };

        if (mode === 'wall') {
          const line = new fabric.Line([sp.x, sp.y, sp.x, sp.y], {
            stroke: STROKE,
            strokeWidth: 4,
            strokeLineCap: 'round',
            selectable: false,
            evented: false,
          });
          tagged(line, 'wall');
          canvas.add(line);
          drawingRef.current = { kind: 'wall', object: line, origin: { x: sp.x, y: sp.y } };
        } else if (mode === 'room') {
          const rect = new fabric.Rect({
            left: sp.x,
            top: sp.y,
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
          drawingRef.current = { kind: 'room', object: rect, origin: { x: sp.x, y: sp.y } };
        } else if (mode === 'furniture') {
          addFurnitureAt(canvas, raw, furnitureKindRef.current);
          emitDirty();
          snapshot();
          autoRevertToSelect();
        }
      };

      const handlePointerMove = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        if (!interactiveRef.current) return;
        const e = opt.e as MouseEvent;

        if (panningRef.current && panOriginRef.current) {
          const dx = e.clientX - panOriginRef.current.x;
          const dy = e.clientY - panOriginRef.current.y;
          panOriginRef.current = { x: e.clientX, y: e.clientY };
          const vt = canvas.viewportTransform;
          if (vt) {
            vt[4] += dx;
            vt[5] += dy;
            canvas.requestRenderAll();
            updateGrid();
          }
          return;
        }

        const draft = drawingRef.current;
        if (!draft) return;
        const raw = canvas.getScenePoint(opt.e);
        const sp = { x: snap(raw.x), y: snap(raw.y) };
        const screen = screenFromMouse(e);

        if (draft.kind === 'wall') {
          let { x, y } = sp;
          if (e.shiftKey) {
            const dx = Math.abs(x - draft.origin.x);
            const dy = Math.abs(y - draft.origin.y);
            if (dx >= dy) y = draft.origin.y;
            else x = draft.origin.x;
          }
          (draft.object as fabric.Line).set({ x2: x, y2: y });
          const len = Math.hypot(x - draft.origin.x, y - draft.origin.y);
          setHud(screen.x + 14, screen.y + 14, formatLength(len));
        } else {
          const rect = draft.object as fabric.Rect;
          rect.set({
            left: Math.min(sp.x, draft.origin.x),
            top: Math.min(sp.y, draft.origin.y),
            width: Math.abs(sp.x - draft.origin.x),
            height: Math.abs(sp.y - draft.origin.y),
          });
          setHud(
            screen.x + 14,
            screen.y + 14,
            `${formatLength(rect.width ?? 0)} × ${formatLength(rect.height ?? 0)}`,
          );
        }
        canvas.requestRenderAll();
      };

      const handlePointerUp = () => {
        if (panningRef.current) {
          panningRef.current = false;
          panOriginRef.current = null;
          canvas.setCursor(spaceHeldRef.current ? 'grab' : modeCursor());
          return;
        }
        const draft = drawingRef.current;
        if (!draft) return;
        // Reject zero-size strokes (clicks without drag).
        if (draft.kind === 'wall') {
          const line = draft.object as fabric.Line;
          const len = Math.hypot((line.x2 ?? 0) - (line.x1 ?? 0), (line.y2 ?? 0) - (line.y1 ?? 0));
          if (len < 4) {
            canvas.remove(line);
            drawingRef.current = null;
            setHud(null);
            autoRevertToSelect();
            return;
          }
        } else {
          const rect = draft.object as fabric.Rect;
          if ((rect.width ?? 0) < 4 || (rect.height ?? 0) < 4) {
            canvas.remove(rect);
            drawingRef.current = null;
            setHud(null);
            autoRevertToSelect();
            return;
          }
        }
        draft.object.set({ selectable: true, evented: true });
        canvas.setActiveObject(draft.object);
        emitDirty();
        snapshot();
        drawingRef.current = null;
        setHud(null);
        autoRevertToSelect();
      };

      const handleWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
        const e = opt.e;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** e.deltaY;
        zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
        canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), zoom);
        updateGrid();
        e.preventDefault();
        e.stopPropagation();
      };

      const handleObjectModified = () => {
        if (!interactiveRef.current || replayingRef.current) return;
        emitDirty();
        snapshot();
      };

      canvas.on('mouse:down', handlePointerDown);
      canvas.on('mouse:move', handlePointerMove);
      canvas.on('mouse:up', handlePointerUp);
      canvas.on('mouse:wheel', handleWheel);
      canvas.on('object:modified', handleObjectModified);
      canvas.on('object:added', emitEmpty);
      canvas.on('object:removed', emitEmpty);
      canvas.on('after:render', updateGrid);

      // ─── Initial load ───────────────────────────────────────────────────
      const finishLoad = () => {
        backfillKinds(canvas, initialJson);
        canvas.renderAll();
        updateGrid();
        emitEmpty();
        interactiveRef.current = true;
        const initialState = canvas.toObject(EXTRA_PROPS);
        historyRef.current = { stack: [initialState], idx: 0 };
      };

      if (initialJson && typeof initialJson === 'object') {
        canvas
          .loadFromJSON(initialJson as Record<string, unknown>)
          .then(finishLoad)
          .catch((err) => {
            console.error('floor-plan: loadFromJSON failed', err);
            interactiveRef.current = true;
            historyRef.current = { stack: [canvas.toObject(EXTRA_PROPS)], idx: 0 };
          });
      } else {
        finishLoad();
      }

      // ─── Keyboard ───────────────────────────────────────────────────────
      const isTextTarget = (target: EventTarget | null): boolean => {
        const tag = (target as HTMLElement | null)?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA';
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (isTextTarget(e.target)) return;
        if ((e.key === ' ' || e.code === 'Space') && !spaceHeldRef.current) {
          spaceHeldRef.current = true;
          canvas.defaultCursor = 'grab';
          canvas.selection = false;
          e.preventDefault();
          return;
        }
        const mod = e.metaKey || e.ctrlKey;
        const isZ = e.key === 'z' || e.key === 'Z';
        if (mod && !e.shiftKey && isZ) {
          e.preventDefault();
          undo();
          return;
        }
        if (mod && ((e.shiftKey && isZ) || e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          redo();
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          const obj = canvas.getActiveObject();
          if (!obj) return;
          canvas.remove(obj);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          emitDirty();
          snapshot();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.key === ' ' || e.code === 'Space') {
          spaceHeldRef.current = false;
          panningRef.current = false;
          panOriginRef.current = null;
          canvas.defaultCursor = modeCursor();
          canvas.selection = modeRef.current === 'select';
        }
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        canvas.dispose();
        fabricRef.current = null;
      };
      // initialJson + scale intentionally excluded — initialJson is loaded
      // once on mount; scale is read via scaleRef so the HUD stays accurate
      // without re-mounting the canvas.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height]);

    useImperativeHandle(
      ref,
      () => ({
        setMode: (mode, kind) => {
          modeRef.current = mode;
          if (kind) furnitureKindRef.current = kind;
          const canvas = fabricRef.current;
          if (canvas) {
            canvas.selection = mode === 'select';
            canvas.defaultCursor = mode === 'select' ? 'default' : 'crosshair';
          }
        },
        setFurnitureKind: (kind) => {
          furnitureKindRef.current = kind;
        },
        serialize: () => fabricRef.current?.toObject(EXTRA_PROPS) ?? null,
        deserialize: async (data) => {
          const canvas = fabricRef.current;
          if (!canvas || !data || typeof data !== 'object') return;
          await canvas.loadFromJSON(data as Record<string, unknown>);
          backfillKinds(canvas, data);
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
        undo: () => {
          const c = fabricRef.current as unknown as { __fpUndo?: () => void } | null;
          c?.__fpUndo?.();
        },
        redo: () => {
          const c = fabricRef.current as unknown as { __fpRedo?: () => void } | null;
          c?.__fpRedo?.();
        },
        fitToContent: () => {
          const canvas = fabricRef.current;
          if (!canvas) return;
          const objs = canvas.getObjects();
          if (objs.length === 0) {
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            canvas.requestRenderAll();
            return;
          }
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const o of objs) {
            const b = o.getBoundingRect();
            minX = Math.min(minX, b.left);
            minY = Math.min(minY, b.top);
            maxX = Math.max(maxX, b.left + b.width);
            maxY = Math.max(maxY, b.top + b.height);
          }
          const pad = 40;
          const cw = canvas.getWidth();
          const ch = canvas.getHeight();
          const bw = Math.max(maxX - minX, 1);
          const bh = Math.max(maxY - minY, 1);
          const zoom = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh, ZOOM_MAX);
          const tx = (cw - bw * zoom) / 2 - minX * zoom;
          const ty = (ch - bh * zoom) / 2 - minY * zoom;
          canvas.setViewportTransform([zoom, 0, 0, zoom, tx, ty]);
          canvas.requestRenderAll();
        },
      }),
      [],
    );

    return (
      <div
        ref={wrapperRef}
        className={cn(
          'relative overflow-hidden rounded-lg border border-border bg-card',
          className,
        )}
        style={{ width, height }}
      >
        <div
          ref={gridRef}
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(116,140,171,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(116,140,171,0.14) 1px, transparent 1px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            backgroundPosition: '0 0',
          }}
        />
        <canvas ref={canvasElRef} width={width} height={height} className="relative z-10" />
        <div
          ref={hudRef}
          className="pointer-events-none absolute z-20 rounded-md bg-popover px-2 py-0.5 font-mono text-xs text-popover-foreground shadow"
          style={{ display: 'none' }}
        />
      </div>
    );
  },
);

function backfillKinds(canvas: fabric.Canvas, json: unknown): void {
  const objects = (json as { objects?: Array<{ __fpKind?: string }> } | null)?.objects;
  if (!objects) return;
  const live = canvas.getObjects();
  const len = Math.min(live.length, objects.length);
  for (let i = 0; i < len; i++) {
    const tag = objects[i]?.__fpKind;
    const obj = live[i];
    if (tag && obj && !kindOf(obj)) {
      (obj as unknown as { __fpKind?: string }).__fpKind = tag;
    }
  }
}

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
    left: snap(point.x),
    top: snap(point.y),
    originX: 'center',
    originY: 'center',
  });
  tagged(group, 'furniture');
  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.requestRenderAll();
}
