import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as fabric from 'fabric';
import { cn } from '@/lib/utils';
import { addFurnitureAt } from './furniture';
import {
  JOIN_DISCONNECT_NUDGE,
  canonicaliseLine,
  collectEndpoints,
  findConnectedPartners,
  findJoins,
  lineWorldEndpoints,
  polygonWorldVertices,
  rectToPolygonVertices,
  setLineEndpoint,
  setPolygonVertices,
  snapToEndpoint,
  type WallJoin,
  type WorldPoint,
} from './geometry';
import type { FloorPlanCanvasHandle, FurnitureKind, SelectionDescriptor, ToolMode } from './types';

interface FloorPlanCanvasProps {
  initialJson: unknown;
  scale: number | null;
  showDimensions?: boolean;
  onDirty?: () => void;
  onModeChange?: (next: ToolMode) => void;
  onIsEmptyChange?: (isEmpty: boolean) => void;
  onSelectionChange?: (desc: SelectionDescriptor) => void;
  width?: number;
  height?: number;
  className?: string;
}

const STROKE = '#3e5c76';
const ROOM_FILL = 'rgba(116, 140, 171, 0.06)';

const GRID_SIZE = 20;
const HISTORY_LIMIT = 50;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;
// Endpoint snap window in *screen* pixels. Divided by current zoom before
// being applied in world space so the felt distance stays the same at any
// zoom.
const SNAP_PX = 14;
const VERTEX_CLOSE_PX = 14;
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

function describeSelection(canvas: fabric.Canvas): SelectionDescriptor {
  const active = canvas.getActiveObject();
  if (!active) return { kind: 'none' };
  const activeSel = active as unknown as { _objects?: fabric.Object[] };
  if (Array.isArray(activeSel._objects) && activeSel._objects.length > 1) {
    return { kind: 'multi', count: activeSel._objects.length };
  }
  if (active instanceof fabric.Line) {
    const ends = lineWorldEndpoints(active);
    const len = Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y);
    return { kind: 'wall', pixelLength: len };
  }
  if (active instanceof fabric.Polygon) {
    return { kind: 'polygon' };
  }
  if (active instanceof fabric.Rect && kindOf(active) === 'room') {
    return { kind: 'room' };
  }
  return { kind: 'furniture' };
}

/** Lock walls and polygon-rooms from default Fabric transform handles —
 *  editing happens through our DOM endpoint/vertex handles instead. */
function applyEditableLocks(obj: fabric.Object): void {
  obj.set({
    hasBorders: false,
    hasControls: false,
    lockScalingFlip: true,
  });
}

export const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, FloorPlanCanvasProps>(
  function FloorPlanCanvas(
    {
      initialJson,
      scale,
      showDimensions,
      onDirty,
      onModeChange,
      onIsEmptyChange,
      onSelectionChange,
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
    const handlesLayerRef = useRef<HTMLDivElement>(null);
    const labelsLayerRef = useRef<HTMLDivElement>(null);
    const joinsLayerRef = useRef<HTMLDivElement>(null);
    const snapIndicatorRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);

    const modeRef = useRef<ToolMode>('select');
    const furnitureKindRef = useRef<FurnitureKind>('bed');
    const drawingRef = useRef<{
      kind: 'wall' | 'room';
      object: fabric.Line | fabric.Rect;
      origin: { x: number; y: number };
    } | null>(null);
    const polygonDraftRef = useRef<{
      vertices: WorldPoint[];
      polygon: fabric.Polygon | null;
      previewLine: fabric.Line | null;
    } | null>(null);

    // Stable refs for callbacks/data so changes don't re-mount the canvas.
    const onDirtyRef = useRef(onDirty);
    const onModeChangeRef = useRef(onModeChange);
    const onIsEmptyChangeRef = useRef(onIsEmptyChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const scaleRef = useRef(scale);
    const showDimensionsRef = useRef(showDimensions ?? true);

    const interactiveRef = useRef(false);
    const replayingRef = useRef(false);
    const spaceHeldRef = useRef(false);
    const panningRef = useRef(false);
    const panOriginRef = useRef<{ x: number; y: number } | null>(null);

    // Endpoint partners that should follow the active wall when it
    // translates (whole-wall fabric drag) or its endpoint gets dragged via
    // a DOM handle. Captured at drag start, applied each frame.
    const translateRef = useRef<{
      wall: fabric.Line;
      startCenter: { x: number; y: number };
      partners: { wall: fabric.Line; endpointIdx: 0 | 1; anchor: WorldPoint }[];
    } | null>(null);

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
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);
    useEffect(() => {
      scaleRef.current = scale;
    }, [scale]);
    useEffect(() => {
      showDimensionsRef.current = showDimensions ?? true;
      // Force a re-render so the labels layer reflects the new toggle
      // immediately rather than waiting for the next canvas event.
      const canvas = fabricRef.current;
      if (canvas) canvas.requestRenderAll();
    }, [showDimensions]);

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
      // React 19 strict mode mounts then immediately re-mounts effects in
      // dev. Async loadFromJSON / replay continuations would otherwise try
      // to render onto the disposed canvas.
      let disposed = false;

      // Pools of DOM elements, recycled across renders.
      const handleEls: HTMLDivElement[] = [];
      const labelEls = new Map<fabric.Object, HTMLDivElement>();
      const joinEls: HTMLDivElement[] = [];

      // ─── Helpers ────────────────────────────────────────────────────────
      const modeCursor = () => (modeRef.current === 'select' ? 'default' : 'crosshair');

      const setEventedForAll = (mode: ToolMode) => {
        const evented = mode === 'select';
        for (const obj of canvas.getObjects()) {
          if (kindOf(obj)) obj.evented = evented;
        }
      };

      const autoRevertToSelect = () => {
        modeRef.current = 'select';
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        setEventedForAll('select');
        onModeChangeRef.current?.('select');
      };

      const emitDirty = () => {
        if (!interactiveRef.current || replayingRef.current) return;
        onDirtyRef.current?.();
      };

      const emitEmpty = () => {
        const total = canvas.getObjects().filter((o) => kindOf(o)).length;
        onIsEmptyChangeRef.current?.(total === 0);
      };

      const emitSelection = () => {
        onSelectionChangeRef.current?.(describeSelection(canvas));
      };

      const snapshot = () => {
        if (!interactiveRef.current || replayingRef.current) return;
        const state = canvas.toObject(EXTRA_PROPS);
        const h = historyRef.current;
        if (h.idx < h.stack.length - 1) h.stack = h.stack.slice(0, h.idx + 1);
        h.stack.push(state);
        if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
        h.idx = h.stack.length - 1;
      };

      const replay = (state: unknown) => {
        replayingRef.current = true;
        canvas
          .loadFromJSON(state as Record<string, unknown>)
          .then(() => {
            if (disposed) return;
            backfillKinds(canvas, state);
            applyLocksToAll(canvas);
            setEventedForAll(modeRef.current);
            canvas.renderAll();
            replayingRef.current = false;
            onDirtyRef.current?.();
            emitEmpty();
            updateGrid();
            renderHandles();
            renderLabelsAndJoins();
          })
          .catch((err) => {
            if (disposed) return;
            console.error('floor-plan: replay failed', err);
            replayingRef.current = false;
          });
      };

      const undo = () => {
        if (drawingRef.current || polygonDraftRef.current) return;
        const h = historyRef.current;
        if (h.idx <= 0) return;
        h.idx -= 1;
        replay(h.stack[h.idx]);
      };

      const redo = () => {
        if (drawingRef.current || polygonDraftRef.current) return;
        const h = historyRef.current;
        if (h.idx >= h.stack.length - 1) return;
        h.idx += 1;
        replay(h.stack[h.idx]);
      };

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
        grid.style.backgroundSize = `${GRID_SIZE * z}px ${GRID_SIZE * z}px`;
        grid.style.backgroundPosition = `${vt[4]}px ${vt[5]}px`;
      };

      const screenFromMouse = (e: MouseEvent) => {
        const rect = canvas.upperCanvasEl.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };

      const screenFromWorld = (p: WorldPoint) => {
        const vt = canvas.viewportTransform;
        if (!vt) return { x: 0, y: 0 };
        return { x: p.x * vt[0] + vt[4], y: p.y * vt[3] + vt[5] };
      };

      const worldFromScreen = (sx: number, sy: number) => {
        const vt = canvas.viewportTransform;
        if (!vt) return { x: sx, y: sy };
        return { x: (sx - vt[4]) / vt[0], y: (sy - vt[5]) / vt[3] };
      };

      const trySnapWorld = (
        p: WorldPoint,
        exclude?: fabric.Object,
      ): { x: number; y: number; snapped: boolean } => {
        const eps = collectEndpoints(canvas, exclude);
        const zoom = canvas.getZoom() || 1;
        return snapToEndpoint(p, eps, SNAP_PX / zoom);
      };

      const setSnapIndicator = (world: WorldPoint | null) => {
        const el = snapIndicatorRef.current;
        if (!el) return;
        if (!world) {
          el.style.display = 'none';
          return;
        }
        const screen = screenFromWorld(world);
        el.style.display = 'block';
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
      };

      // ─── DOM endpoint / vertex handles ──────────────────────────────────
      function ensureHandle(idx: number): HTMLDivElement {
        let el = handleEls[idx];
        if (el) return el;
        el = document.createElement('div');
        el.className =
          'pointer-events-auto absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-[#3e5c76] shadow';
        el.style.touchAction = 'none';
        el.dataset.handleIndex = String(idx);
        handleEls[idx] = el;
        handlesLayerRef.current?.appendChild(el);
        attachHandlePointer(el);
        return el;
      }

      function attachHandlePointer(el: HTMLDivElement) {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = Number(el.dataset.handleIndex ?? '0') as 0 | 1;
          const active = canvas.getActiveObject();
          if (!active) return;
          el.setPointerCapture(e.pointerId);
          el.style.cursor = 'grabbing';

          // Capture connected partners up front so they translate in
          // lockstep with the dragged endpoint.
          let partners: { wall: fabric.Line; endpointIdx: 0 | 1 }[] = [];
          if (active instanceof fabric.Line && kindOf(active) === 'wall') {
            partners = findConnectedPartners(canvas, active, idx);
          }

          const onMove = (ev: PointerEvent) => {
            const rect = canvas.upperCanvasEl.getBoundingClientRect();
            const sx = ev.clientX - rect.left;
            const sy = ev.clientY - rect.top;
            const w = worldFromScreen(sx, sy);
            const gridSnapped = { x: snap(w.x), y: snap(w.y) };
            const epSnap = trySnapWorld(gridSnapped, active);
            const target = epSnap.snapped ? epSnap : gridSnapped;
            setSnapIndicator(epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : null);

            if (active instanceof fabric.Line) {
              setLineEndpoint(active, idx, target.x, target.y);
              for (const p of partners) {
                setLineEndpoint(p.wall, p.endpointIdx, target.x, target.y);
              }
            } else if (active instanceof fabric.Polygon) {
              const verts = polygonWorldVertices(active);
              verts[idx] = { x: target.x, y: target.y };
              setPolygonVertices(active, verts);
            }
            canvas.requestRenderAll();
            renderHandles();
            renderLabelsAndJoins();
            emitDirty();
          };

          const onUp = () => {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.style.cursor = 'grab';
            const a = canvas.getActiveObject();
            if (a instanceof fabric.Line) canonicaliseLine(a);
            for (const p of partners) canonicaliseLine(p.wall);
            canvas.requestRenderAll();
            snapshot();
            emitSelection();
            renderHandles();
            renderLabelsAndJoins();
            setSnapIndicator(null);
          };

          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup', onUp);
        });
      }

      function renderHandles() {
        const layer = handlesLayerRef.current;
        if (!layer) return;
        for (const el of handleEls) el.style.display = 'none';
        if (modeRef.current !== 'select') return;
        const active = canvas.getActiveObject();
        if (!active) return;
        const asGroup = active as unknown as { _objects?: unknown[] };
        if (Array.isArray(asGroup._objects) && asGroup._objects.length > 1) return;

        let positions: WorldPoint[] = [];
        if (active instanceof fabric.Line && kindOf(active) === 'wall') {
          const e = lineWorldEndpoints(active);
          positions = [e.start, e.end];
        } else if (active instanceof fabric.Polygon && kindOf(active) === 'room') {
          positions = polygonWorldVertices(active);
        }

        positions.forEach((world, i) => {
          const el = ensureHandle(i);
          const screen = screenFromWorld(world);
          el.style.left = `${screen.x}px`;
          el.style.top = `${screen.y}px`;
          el.style.display = 'block';
        });
      }

      // ─── Labels (wall lengths + furniture dimensions) ───────────────────
      function ensureLabel(obj: fabric.Object): HTMLDivElement {
        let el = labelEls.get(obj);
        if (el) return el;
        el = document.createElement('div');
        el.className =
          'pointer-events-none absolute z-15 -translate-x-1/2 -translate-y-1/2 rounded-md bg-card/90 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shadow-sm';
        labelEls.set(obj, el);
        labelsLayerRef.current?.appendChild(el);
        return el;
      }

      function disposeLabel(obj: fabric.Object) {
        const el = labelEls.get(obj);
        if (el) {
          el.remove();
          labelEls.delete(obj);
        }
      }

      function renderLabels() {
        const layer = labelsLayerRef.current;
        if (!layer) return;
        const visible = showDimensionsRef.current;
        const live = canvas.getObjects();
        const liveSet = new Set<fabric.Object>(live);
        // Prune labels for removed objects.
        for (const obj of [...labelEls.keys()]) {
          if (!liveSet.has(obj)) disposeLabel(obj);
        }
        if (!visible) {
          for (const el of labelEls.values()) el.style.display = 'none';
          return;
        }
        for (const obj of live) {
          const k = kindOf(obj);
          if (k === 'wall' && obj instanceof fabric.Line) {
            const ends = lineWorldEndpoints(obj);
            const dx = ends.end.x - ends.start.x;
            const dy = ends.end.y - ends.start.y;
            const len = Math.hypot(dx, dy);
            if (len < 4) {
              disposeLabel(obj);
              continue;
            }
            const mid = {
              x: (ends.start.x + ends.end.x) / 2,
              y: (ends.start.y + ends.end.y) / 2,
            };
            const midScreen = screenFromWorld(mid);
            // Perpendicular offset (in screen px) so the label sits beside
            // the wall, not on top of it.
            const perp = { x: -dy / len, y: dx / len };
            const offset = 16;
            const labelScreen = {
              x: midScreen.x + perp.x * offset,
              y: midScreen.y + perp.y * offset,
            };
            const el = ensureLabel(obj);
            el.textContent = formatLength(len);
            el.style.display = 'block';
            el.style.left = `${labelScreen.x}px`;
            el.style.top = `${labelScreen.y}px`;
          } else if (k === 'furniture' && obj instanceof fabric.Group) {
            // Furniture group's left/top are the world centre (CENTER origin).
            const cx = obj.left ?? 0;
            const cy = obj.top ?? 0;
            const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
            const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
            const labelWorld = { x: cx, y: cy + h / 2 };
            const labelScreen = screenFromWorld(labelWorld);
            const el = ensureLabel(obj);
            el.textContent = `${formatLength(w)} × ${formatLength(h)}`;
            el.style.display = 'block';
            el.style.left = `${labelScreen.x}px`;
            el.style.top = `${labelScreen.y + 12}px`;
          } else {
            disposeLabel(obj);
          }
        }
      }

      // ─── Joins (where two or more wall endpoints coincide) ──────────────
      function ensureJoin(idx: number): HTMLDivElement {
        let el = joinEls[idx];
        if (el) return el;
        el = document.createElement('div');
        el.className =
          'absolute z-22 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-500/80 bg-transparent';
        el.style.touchAction = 'none';
        joinEls[idx] = el;
        joinsLayerRef.current?.appendChild(el);
        attachJoinPointer(el, idx);
        return el;
      }

      function attachJoinPointer(el: HTMLDivElement, idx: number) {
        el.addEventListener('pointerdown', (e) => {
          if (modeRef.current !== 'select') return;
          e.preventDefault();
          e.stopPropagation();
          const join = currentJoinsRef.current[idx];
          if (!join) return;
          // Disconnect: nudge each member except the first by a small
          // distinct offset so they're no longer at a shared coordinate.
          // Reversible via undo.
          for (let i = 1; i < join.members.length; i++) {
            const m = join.members[i]!;
            const angle = (i / join.members.length) * Math.PI * 2;
            const ox = Math.cos(angle) * JOIN_DISCONNECT_NUDGE;
            const oy = Math.sin(angle) * JOIN_DISCONNECT_NUDGE;
            const ends = lineWorldEndpoints(m.wall);
            const target = m.endpointIdx === 0 ? ends.start : ends.end;
            setLineEndpoint(m.wall, m.endpointIdx, target.x + ox, target.y + oy);
            canonicaliseLine(m.wall);
          }
          canvas.requestRenderAll();
          emitDirty();
          snapshot();
          renderHandles();
          renderLabelsAndJoins();
        });
      }

      const currentJoinsRef: { current: WallJoin[] } = { current: [] };

      function renderJoins() {
        const layer = joinsLayerRef.current;
        if (!layer) return;
        const joins = findJoins(canvas);
        currentJoinsRef.current = joins;
        // Hide unused join elements
        for (let i = joins.length; i < joinEls.length; i++) {
          if (joinEls[i]) joinEls[i]!.style.display = 'none';
        }
        const interactive = modeRef.current === 'select';
        joins.forEach((join, i) => {
          const el = ensureJoin(i);
          const screen = screenFromWorld({ x: join.x, y: join.y });
          el.style.left = `${screen.x}px`;
          el.style.top = `${screen.y}px`;
          el.style.display = 'block';
          el.style.pointerEvents = interactive ? 'auto' : 'none';
          el.style.cursor = interactive ? 'pointer' : 'default';
          el.title = interactive
            ? `${join.members.length} walls join here · click to disconnect`
            : `${join.members.length} walls join here`;
        });
      }

      const renderLabelsAndJoins = () => {
        renderLabels();
        renderJoins();
      };

      // ─── Pointer handlers ───────────────────────────────────────────────
      const handlePointerDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        if (!interactiveRef.current) return;
        const e = opt.e as MouseEvent;

        if (spaceHeldRef.current) {
          panningRef.current = true;
          panOriginRef.current = { x: e.clientX, y: e.clientY };
          canvas.setCursor('grabbing');
          return;
        }

        const mode = modeRef.current;
        if (mode === 'select') {
          // Capture potential whole-wall drag state up front so partner
          // endpoints can follow in lockstep. We must do this *before*
          // Fabric begins translating, otherwise startCenter/anchor read
          // mid-drag and the join silently drifts.
          const target = canvas.findTarget(opt.e);
          if (target instanceof fabric.Line && kindOf(target) === 'wall') {
            const ends = lineWorldEndpoints(target);
            translateRef.current = {
              wall: target,
              startCenter: { x: target.left ?? 0, y: target.top ?? 0 },
              partners: [
                ...findConnectedPartners(canvas, target, 0).map((p) => ({
                  ...p,
                  anchor: ends.start,
                })),
                ...findConnectedPartners(canvas, target, 1).map((p) => ({
                  ...p,
                  anchor: ends.end,
                })),
              ],
            };
          } else {
            translateRef.current = null;
          }
          return;
        }

        const raw = canvas.getScenePoint(opt.e);
        const gridSnapped = { x: snap(raw.x), y: snap(raw.y) };
        const epSnap = trySnapWorld(gridSnapped);
        const sp = epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : gridSnapped;
        if (epSnap.snapped) setSnapIndicator({ x: epSnap.x, y: epSnap.y });

        if (mode === 'wall') {
          const draft = drawingRef.current;
          if (!draft) {
            // First click: place the start endpoint.
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
          } else {
            // Second click: finalise.
            const line = draft.object as fabric.Line;
            line.set({ x2: sp.x, y2: sp.y });
            const len = Math.hypot(sp.x - draft.origin.x, sp.y - draft.origin.y);
            if (len < 4) {
              canvas.remove(line);
              drawingRef.current = null;
              setHud(null);
              setSnapIndicator(null);
              return;
            }
            applyEditableLocks(line);
            line.set({ selectable: true, evented: modeRef.current === 'select' });
            emitDirty();
            snapshot();
            drawingRef.current = null;
            setHud(null);
            setSnapIndicator(null);
            renderHandles();
            renderLabelsAndJoins();
            // Stay in wall mode so the caregiver can chain walls — clicking
            // the just-placed endpoint snaps the next wall onto it. Press
            // Escape (or the Select tool) to exit.
          }
        } else if (mode === 'room') {
          const rect = new fabric.Rect({
            left: sp.x,
            top: sp.y,
            width: 1,
            height: 1,
            originX: 'left',
            originY: 'top',
            fill: ROOM_FILL,
            stroke: STROKE,
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
          tagged(rect, 'room');
          canvas.add(rect);
          drawingRef.current = { kind: 'room', object: rect, origin: { x: sp.x, y: sp.y } };
        } else if (mode === 'polygon') {
          handlePolygonClick(sp);
        } else if (mode === 'furniture') {
          addFurnitureAt(canvas, raw, furnitureKindRef.current, scaleRef.current, snap);
          emitDirty();
          snapshot();
          autoRevertToSelect();
          renderLabelsAndJoins();
        }
      };

      const handlePolygonClick = (point: WorldPoint) => {
        const draft = polygonDraftRef.current;
        if (!draft) {
          const previewLine = new fabric.Line([point.x, point.y, point.x, point.y], {
            stroke: STROKE,
            strokeWidth: 1.5,
            strokeDashArray: [6, 4],
            selectable: false,
            evented: false,
          });
          canvas.add(previewLine);
          polygonDraftRef.current = {
            vertices: [{ x: point.x, y: point.y }],
            polygon: null,
            previewLine,
          };
          return;
        }
        const first = draft.vertices[0];
        if (
          first &&
          draft.vertices.length >= 3 &&
          Math.hypot(first.x - point.x, first.y - point.y) < VERTEX_CLOSE_PX
        ) {
          finalisePolygon();
          return;
        }
        draft.vertices.push({ x: point.x, y: point.y });
        if (draft.polygon) {
          setPolygonVertices(draft.polygon, draft.vertices);
        } else if (draft.vertices.length >= 2) {
          const poly = new fabric.Polygon(
            draft.vertices.map((v) => new fabric.Point(v.x, v.y)),
            {
              fill: ROOM_FILL,
              stroke: STROKE,
              strokeWidth: 2,
              selectable: false,
              evented: false,
            },
          );
          tagged(poly, 'room');
          canvas.add(poly);
          draft.polygon = poly;
        }
        if (draft.previewLine) {
          draft.previewLine.set({
            x1: point.x,
            y1: point.y,
            x2: point.x,
            y2: point.y,
          });
        }
        canvas.requestRenderAll();
      };

      const finalisePolygon = () => {
        const draft = polygonDraftRef.current;
        if (!draft) return;
        if (draft.previewLine) canvas.remove(draft.previewLine);
        if (!draft.polygon || draft.vertices.length < 3) {
          if (draft.polygon) canvas.remove(draft.polygon);
          polygonDraftRef.current = null;
          autoRevertToSelect();
          canvas.requestRenderAll();
          return;
        }
        canvas.remove(draft.polygon);
        const finalPoly = new fabric.Polygon(
          draft.vertices.map((v) => new fabric.Point(v.x, v.y)),
          { fill: ROOM_FILL, stroke: STROKE, strokeWidth: 2 },
        );
        tagged(finalPoly, 'room');
        applyEditableLocks(finalPoly);
        finalPoly.evented = modeRef.current === 'select';
        canvas.add(finalPoly);
        canvas.setActiveObject(finalPoly);
        polygonDraftRef.current = null;
        canvas.requestRenderAll();
        emitDirty();
        snapshot();
        emitEmpty();
        autoRevertToSelect();
        renderHandles();
        renderLabelsAndJoins();
      };

      const cancelPolygonDraft = () => {
        const draft = polygonDraftRef.current;
        if (!draft) return;
        if (draft.previewLine) canvas.remove(draft.previewLine);
        if (draft.polygon) canvas.remove(draft.polygon);
        polygonDraftRef.current = null;
        canvas.requestRenderAll();
      };

      const cancelWallDraft = () => {
        const draft = drawingRef.current;
        if (!draft || draft.kind !== 'wall') return;
        canvas.remove(draft.object);
        drawingRef.current = null;
        setHud(null);
        setSnapIndicator(null);
        canvas.requestRenderAll();
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
            renderHandles();
            renderLabelsAndJoins();
          }
          return;
        }

        const polyDraft = polygonDraftRef.current;
        if (polyDraft && polyDraft.previewLine && modeRef.current === 'polygon') {
          const raw = canvas.getScenePoint(opt.e);
          const gridSnapped = { x: snap(raw.x), y: snap(raw.y) };
          const epSnap = trySnapWorld(gridSnapped);
          const tip = epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : gridSnapped;
          setSnapIndicator(epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : null);
          const last = polyDraft.vertices[polyDraft.vertices.length - 1];
          if (last) {
            polyDraft.previewLine.set({ x1: last.x, y1: last.y, x2: tip.x, y2: tip.y });
            const screen = screenFromMouse(e);
            const len = Math.hypot(tip.x - last.x, tip.y - last.y);
            setHud(screen.x + 14, screen.y + 14, formatLength(len));
            canvas.requestRenderAll();
          }
          return;
        }

        const drawing = drawingRef.current;
        if (!drawing) return;
        const raw = canvas.getScenePoint(opt.e);
        const gridSnapped = { x: snap(raw.x), y: snap(raw.y) };
        const epSnap = trySnapWorld(gridSnapped, drawing.object);
        const sp = epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : gridSnapped;
        setSnapIndicator(epSnap.snapped ? { x: epSnap.x, y: epSnap.y } : null);
        const screen = screenFromMouse(e);

        if (drawing.kind === 'wall') {
          let { x, y } = sp;
          if (e.shiftKey && !epSnap.snapped) {
            const dx = Math.abs(x - drawing.origin.x);
            const dy = Math.abs(y - drawing.origin.y);
            if (dx >= dy) y = drawing.origin.y;
            else x = drawing.origin.x;
          }
          (drawing.object as fabric.Line).set({ x2: x, y2: y });
          const len = Math.hypot(x - drawing.origin.x, y - drawing.origin.y);
          setHud(screen.x + 14, screen.y + 14, formatLength(len));
        } else {
          const rect = drawing.object as fabric.Rect;
          rect.set({
            left: Math.min(sp.x, drawing.origin.x),
            top: Math.min(sp.y, drawing.origin.y),
            width: Math.abs(sp.x - drawing.origin.x),
            height: Math.abs(sp.y - drawing.origin.y),
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
        const drawing = drawingRef.current;
        // Wall draws use click-click (handled in pointer-down). Pointer-up
        // is only the room drag-rect terminator now.
        if (!drawing || drawing.kind !== 'room') return;
        const rect = drawing.object as fabric.Rect;
        if ((rect.width ?? 0) < 4 || (rect.height ?? 0) < 4) {
          canvas.remove(rect);
          drawingRef.current = null;
          setHud(null);
          autoRevertToSelect();
          return;
        }
        // Promote rectangle room to an editable polygon.
        const verts = rectToPolygonVertices(rect);
        canvas.remove(rect);
        const poly = new fabric.Polygon(
          verts.map((v) => new fabric.Point(v.x, v.y)),
          { fill: ROOM_FILL, stroke: STROKE, strokeWidth: 2 },
        );
        tagged(poly, 'room');
        applyEditableLocks(poly);
        poly.evented = modeRef.current === 'select';
        canvas.add(poly);
        canvas.setActiveObject(poly);
        emitDirty();
        snapshot();
        drawingRef.current = null;
        setHud(null);
        setSnapIndicator(null);
        autoRevertToSelect();
        renderHandles();
        renderLabelsAndJoins();
        emitSelection();
      };

      const handleWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
        const e = opt.e;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** e.deltaY;
        zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
        canvas.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), zoom);
        updateGrid();
        renderHandles();
        renderLabelsAndJoins();
        e.preventDefault();
        e.stopPropagation();
      };

      // ─── Connected wall translate (whole-wall fabric drag) ──────────────
      canvas.on('object:moving', (opt: { target?: fabric.Object }) => {
        const t = opt.target;
        const state = translateRef.current;
        if (!t || !state || state.wall !== t) return;
        const dx = (t.left ?? 0) - state.startCenter.x;
        const dy = (t.top ?? 0) - state.startCenter.y;
        for (const p of state.partners) {
          setLineEndpoint(p.wall, p.endpointIdx, p.anchor.x + dx, p.anchor.y + dy);
        }
        renderHandles();
        renderLabelsAndJoins();
      });

      const handleObjectModified = (opt: { target?: fabric.Object }) => {
        if (!interactiveRef.current || replayingRef.current) return;
        const t = opt.target;
        if (t instanceof fabric.Line && kindOf(t) === 'wall') {
          canonicaliseLine(t);
          // Also canonicalise any partners that were translated during
          // the drag so their stored coords stay world-space.
          if (translateRef.current && translateRef.current.wall === t) {
            for (const p of translateRef.current.partners) canonicaliseLine(p.wall);
          }
        } else if (t instanceof fabric.Polygon && kindOf(t) === 'room') {
          setPolygonVertices(t, polygonWorldVertices(t));
        }
        translateRef.current = null;
        emitDirty();
        snapshot();
        emitSelection();
        renderHandles();
        renderLabelsAndJoins();
      };

      canvas.on('mouse:down', handlePointerDown);
      canvas.on('mouse:move', handlePointerMove);
      canvas.on('mouse:up', handlePointerUp);
      canvas.on('mouse:dblclick', () => {
        if (modeRef.current === 'polygon') finalisePolygon();
      });
      canvas.on('mouse:wheel', handleWheel);
      canvas.on('object:modified', handleObjectModified);
      canvas.on('object:added', () => {
        emitEmpty();
        renderLabelsAndJoins();
      });
      canvas.on('object:removed', (opt: { target?: fabric.Object }) => {
        emitEmpty();
        if (opt.target) disposeLabel(opt.target);
        renderHandles();
        renderLabelsAndJoins();
      });
      canvas.on('after:render', () => {
        updateGrid();
        renderHandles();
        renderLabelsAndJoins();
      });
      canvas.on('selection:created', () => {
        emitSelection();
        renderHandles();
      });
      canvas.on('selection:updated', () => {
        emitSelection();
        renderHandles();
      });
      canvas.on('selection:cleared', () => {
        emitSelection();
        renderHandles();
      });

      // ─── Initial load ───────────────────────────────────────────────────
      const finishLoad = () => {
        if (disposed) return;
        backfillKinds(canvas, initialJson);
        applyLocksToAll(canvas);
        setEventedForAll(modeRef.current);
        canvas.renderAll();
        updateGrid();
        emitEmpty();
        emitSelection();
        renderLabelsAndJoins();
        interactiveRef.current = true;
        const initialState = canvas.toObject(EXTRA_PROPS);
        historyRef.current = { stack: [initialState], idx: 0 };
      };

      if (initialJson && typeof initialJson === 'object') {
        canvas
          .loadFromJSON(initialJson as Record<string, unknown>)
          .then(finishLoad)
          .catch((err) => {
            if (disposed) return;
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
        if (mod && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault();
          const objs = canvas.getObjects().filter((o) => kindOf(o));
          if (objs.length === 0) return;
          canvas.discardActiveObject();
          const sel = new fabric.ActiveSelection(objs, { canvas });
          canvas.setActiveObject(sel);
          canvas.requestRenderAll();
          emitSelection();
          renderHandles();
          return;
        }
        if (e.key === 'Enter') {
          if (modeRef.current === 'polygon' && polygonDraftRef.current) {
            e.preventDefault();
            finalisePolygon();
          }
          return;
        }
        if (e.key === 'Escape') {
          if (drawingRef.current?.kind === 'wall') {
            cancelWallDraft();
            return;
          }
          if (polygonDraftRef.current) {
            cancelPolygonDraft();
            autoRevertToSelect();
            return;
          }
          if (modeRef.current !== 'select') {
            autoRevertToSelect();
          }
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          const active = canvas.getActiveObject();
          if (!active) return;
          const asGroup = active as unknown as { _objects?: fabric.Object[] };
          if (Array.isArray(asGroup._objects) && asGroup._objects.length > 0) {
            for (const o of asGroup._objects) canvas.remove(o);
          } else {
            canvas.remove(active);
          }
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          emitDirty();
          snapshot();
          emitSelection();
          renderHandles();
          renderLabelsAndJoins();
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
        disposed = true;
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        for (const el of handleEls) el.remove();
        for (const el of labelEls.values()) el.remove();
        for (const el of joinEls) el.remove();
        canvas.dispose();
        fabricRef.current = null;
      };
      // initialJson + scale + showDimensions intentionally excluded — initialJson
      // is loaded once on mount; scale and showDimensions are read via refs so
      // toggling them doesn't re-mount the Fabric canvas.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, height]);

    useImperativeHandle(
      ref,
      () => ({
        setMode: (mode, kind) => {
          const prevMode = modeRef.current;
          modeRef.current = mode;
          if (kind) furnitureKindRef.current = kind;
          const canvas = fabricRef.current;
          if (!canvas) return;
          canvas.selection = mode === 'select';
          canvas.defaultCursor = mode === 'select' ? 'default' : 'crosshair';
          // In drawing modes, prevent fabric from intercepting clicks on
          // existing geometry (so a wall-mode click on an existing wall's
          // endpoint starts a new wall instead of selecting the old one).
          const evented = mode === 'select';
          for (const obj of canvas.getObjects()) {
            if (kindOf(obj)) obj.evented = evented;
          }
          // Drop any pending wall draft when leaving wall mode.
          if (prevMode === 'wall' && mode !== 'wall' && drawingRef.current?.kind === 'wall') {
            canvas.remove(drawingRef.current.object);
            drawingRef.current = null;
          }
          // Same for polygon mode.
          if (prevMode === 'polygon' && mode !== 'polygon' && polygonDraftRef.current) {
            const draft = polygonDraftRef.current;
            if (draft.previewLine) canvas.remove(draft.previewLine);
            if (draft.polygon) canvas.remove(draft.polygon);
            polygonDraftRef.current = null;
          }
          canvas.requestRenderAll();
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
          applyLocksToAll(canvas);
          for (const obj of canvas.getObjects()) {
            if (kindOf(obj)) obj.evented = modeRef.current === 'select';
          }
          canvas.renderAll();
        },
        getSelectedLinePixelLength: () => {
          const canvas = fabricRef.current;
          const obj = canvas?.getActiveObject();
          if (!obj || !(obj instanceof fabric.Line)) return null;
          const ends = lineWorldEndpoints(obj);
          return Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y);
        },
        deleteSelected: () => {
          const canvas = fabricRef.current;
          const obj = canvas?.getActiveObject();
          if (!canvas || !obj) return;
          const asGroup = obj as unknown as { _objects?: fabric.Object[] };
          if (Array.isArray(asGroup._objects) && asGroup._objects.length > 0) {
            for (const o of asGroup._objects) canvas.remove(o);
          } else {
            canvas.remove(obj);
          }
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
          const objs = canvas.getObjects().filter((o) => kindOf(o));
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
        setSelectedWallLength: (metres, scaleMetersPerPixel) => {
          const canvas = fabricRef.current;
          if (!canvas || !Number.isFinite(metres) || metres <= 0) return;
          if (!Number.isFinite(scaleMetersPerPixel) || scaleMetersPerPixel <= 0) return;
          const active = canvas.getActiveObject();
          if (!(active instanceof fabric.Line)) return;
          const ends = lineWorldEndpoints(active);
          const dx = ends.end.x - ends.start.x;
          const dy = ends.end.y - ends.start.y;
          const currentPx = Math.hypot(dx, dy);
          if (currentPx === 0) return;
          const targetPx = metres / scaleMetersPerPixel;
          const ratio = targetPx / currentPx;
          const newEnd = {
            x: ends.start.x + dx * ratio,
            y: ends.start.y + dy * ratio,
          };
          // Setting x1/y1/x2/y2 triggers Line._setWidthHeight which
          // recomputes width/height and repositions the line's centre.
          active.set({
            x1: ends.start.x,
            y1: ends.start.y,
            x2: newEnd.x,
            y2: newEnd.y,
            scaleX: 1,
            scaleY: 1,
            angle: 0,
          });
          active.setCoords();
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
        <div ref={labelsLayerRef} className="pointer-events-none absolute inset-0 z-15" />
        <div ref={handlesLayerRef} className="pointer-events-none absolute inset-0 z-30" />
        <div ref={joinsLayerRef} className="absolute inset-0 z-22" />
        <div
          ref={snapIndicatorRef}
          className="pointer-events-none absolute z-25 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-400 bg-emerald-400/30"
          style={{ display: 'none' }}
        />
        <div
          ref={hudRef}
          className="pointer-events-none absolute z-30 rounded-md bg-popover px-2 py-0.5 font-mono text-xs text-popover-foreground shadow"
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

function applyLocksToAll(canvas: fabric.Canvas): void {
  for (const obj of canvas.getObjects()) {
    const k = kindOf(obj);
    if (k === 'wall' || k === 'room') applyEditableLocks(obj);
  }
}
