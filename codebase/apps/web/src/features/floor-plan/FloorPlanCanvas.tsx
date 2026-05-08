import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { cn } from '@/lib/utils';
import { parseCanvasJson } from './canvasState';
import { addFurnitureAt } from './furniture';
import {
  JOIN_DISCONNECT_NUDGE,
  canonicaliseLine,
  collectEndpoints,
  findClosedRooms,
  findConnectedPartners,
  findConnectedWallGroup,
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
import type {
  BeaconSprite,
  CalibrationPointSprite,
  FloorPlanCanvasHandle,
  FurnitureKind,
  PatientMarkerSprite,
  ReplayDotSprite,
  SelectionDescriptor,
  ToolMode,
} from './types';

interface FloorPlanCanvasProps {
  initialJson: unknown;
  scale: number | null;
  showDimensions?: boolean;
  /** When false, the canvas is read-only — selection, dragging, drawing,
   *  and join clicks are all disabled. Default true so callers that
   *  don't care about the toggle keep the previous behaviour. */
  editing?: boolean;
  /** Initial mode for the canvas. Used by the Beacons sub-tab to mount
   *  in 'beacon-placement' mode without any further setMode call. */
  initialMode?: ToolMode;
  onDirty?: () => void;
  onModeChange?: (next: ToolMode) => void;
  onIsEmptyChange?: (isEmpty: boolean) => void;
  onSelectionChange?: (desc: SelectionDescriptor) => void;
  /** F6: fires when an armed beacon lands on the canvas (initial place)
   *  or an existing placed beacon is dragged to a new spot. The parent
   *  is expected to persist via useUpdateBeaconPosition. */
  onBeaconUpdate?: (beaconId: string, x: number, y: number) => void;
  /** F7: fires when the user clicks on the canvas while calibration
   *  capture is armed. Coords are snapped to the grid. Parent stores
   *  the pending spot and disarms by calling armCalibrationCapture(false). */
  onCalibrationClick?: (x: number, y: number) => void;
  width?: number;
  height?: number;
  className?: string;
  /** Accessible name announced by screen readers (UI-28). The canvas
   *  itself is not natively keyboard-navigable; full canvas a11y
   *  narration is V2. */
  ariaLabel?: string;
}

const STROKE = '#3e5c76';
// Single fill colour shared between fabric.Polygon rooms and the SVG
// shading drawn over closed wall loops, so a polygon and a four-wall
// rectangle look identical once they enclose an area.
const ROOM_FILL = 'rgba(116, 140, 171, 0.18)';

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
      editing,
      initialMode,
      onDirty,
      onModeChange,
      onIsEmptyChange,
      onSelectionChange,
      onBeaconUpdate,
      onCalibrationClick,
      width,
      height,
      className,
      ariaLabel,
    },
    ref,
  ) {
    // When the caller pins explicit pixel dims (tests, embedded previews),
    // use them. Otherwise the wrapper sizes from CSS and we measure it
    // each frame so Fabric's pixel buffer matches the visible box.
    const explicitDims = width != null && height != null;
    const fallbackWidth = width ?? 960;
    const fallbackHeight = height ?? 600;
    const [measured, setMeasured] = useState<{ width: number; height: number }>({
      width: fallbackWidth,
      height: fallbackHeight,
    });
    const canvasWidth = explicitDims ? width : measured.width;
    const canvasHeight = explicitDims ? height : measured.height;
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const hudRef = useRef<HTMLDivElement>(null);
    const handlesLayerRef = useRef<HTMLDivElement>(null);
    const labelsLayerRef = useRef<HTMLDivElement>(null);
    const joinsLayerRef = useRef<HTMLDivElement>(null);
    const beaconsLayerRef = useRef<HTMLDivElement>(null);
    const calibrationLayerRef = useRef<HTMLDivElement>(null);
    const markerLayerRef = useRef<HTMLDivElement>(null);
    const replayDotsLayerRef = useRef<HTMLDivElement>(null);
    const shadingLayerRef = useRef<SVGSVGElement>(null);
    const snapIndicatorRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);

    const modeRef = useRef<ToolMode>(initialMode ?? 'select');
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
    const onBeaconUpdateRef = useRef(onBeaconUpdate);
    const onCalibrationClickRef = useRef(onCalibrationClick);
    const scaleRef = useRef(scale);
    const showDimensionsRef = useRef(showDimensions ?? true);
    const editingRef = useRef(editing ?? true);

    const interactiveRef = useRef(false);
    const replayingRef = useRef(false);
    const spaceHeldRef = useRef(false);
    const panningRef = useRef(false);
    const panOriginRef = useRef<{ x: number; y: number } | null>(null);

    // Whole-wall fabric drag captures the full connected component once,
    // then translates every other wall by the same delta each frame so
    // the joined room moves rigidly. (Endpoint dragging via a DOM handle
    // is the rubber-band case — a different code path that only moves
    // one shared coord.)
    const translateRef = useRef<{
      wall: fabric.Line;
      startCenter: { x: number; y: number };
      followers: { wall: fabric.Line; startCenter: { x: number; y: number } }[];
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
      onBeaconUpdateRef.current = onBeaconUpdate;
    }, [onBeaconUpdate]);
    useEffect(() => {
      onCalibrationClickRef.current = onCalibrationClick;
    }, [onCalibrationClick]);
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
      editingRef.current = editing ?? true;
      const canvas = fabricRef.current;
      if (!canvas) return;
      const interactive = (editing ?? true) && modeRef.current === 'select';
      canvas.selection = interactive;
      for (const obj of canvas.getObjects()) {
        if (kindOf(obj)) obj.evented = interactive;
      }
      // Drop selection + any in-progress draft when leaving edit mode.
      if (!editing) {
        canvas.discardActiveObject();
        if (drawingRef.current) {
          canvas.remove(drawingRef.current.object);
          drawingRef.current = null;
        }
        if (polygonDraftRef.current) {
          const d = polygonDraftRef.current;
          if (d.previewLine) canvas.remove(d.previewLine);
          if (d.polygon) canvas.remove(d.polygon);
          polygonDraftRef.current = null;
        }
        // Force back to select mode so the next entry into edit mode
        // starts cleanly. Beacon-placement is the exception — it's a
        // legit non-editing mode, not a leftover draft state.
        if (modeRef.current !== 'beacon-placement') {
          modeRef.current = 'select';
          canvas.defaultCursor = 'default';
          onModeChangeRef.current?.('select');
        }
      }
      canvas.requestRenderAll();
    }, [editing]);

    useEffect(() => {
      if (!canvasElRef.current) return;
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: canvasWidth,
        height: canvasHeight,
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

      // Pools of DOM elements, recycled across renders. Handles and
      // joins keep pools because their nodes carry pointer event
      // listeners. Labels are rebuilt from scratch each render — there
      // were ghost labels surviving across resize/zoom cycles whose
      // origin we couldn't pin down through static analysis, and a full
      // replaceChildren makes the bug class impossible regardless of
      // root cause.
      const handleEls: HTMLDivElement[] = [];
      const joinEls: HTMLDivElement[] = [];

      // ─── Helpers ────────────────────────────────────────────────────────
      const modeCursor = () => (modeRef.current === 'select' ? 'default' : 'crosshair');

      const setEventedForAll = (mode: ToolMode) => {
        // In beacon-placement, every wall/room/furniture is locked: clicks
        // pass through to the canvas so the beacon-placement handler
        // sees them. Selection/drawing modes follow the F5 rules.
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
        // clearAll is defined later in the effect (after the cancel-draft
        // helpers), so wire it onto the canvas object via a deferred
        // assignment below — see the call right after clearAll's
        // definition.
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
        if (!editingRef.current) return;
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
      const LABEL_CLASS =
        'pointer-events-none absolute z-25 -translate-x-1/2 -translate-y-1/2 rounded-md bg-card/95 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shadow-sm';

      function makeLabel(text: string, screen: WorldPoint): HTMLDivElement {
        const el = document.createElement('div');
        el.className = LABEL_CLASS;
        el.textContent = text;
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        return el;
      }

      function renderLabels() {
        const layer = labelsLayerRef.current;
        if (!layer) return;
        // Rebuild from scratch every call — replaceChildren drops every
        // existing label DOM node, so any stale element from a prior
        // viewport / size / load cycle is gone before we re-emit.
        if (!showDimensionsRef.current) {
          layer.replaceChildren();
          return;
        }
        const next: HTMLDivElement[] = [];
        for (const obj of canvas.getObjects()) {
          const k = kindOf(obj);
          if (k === 'wall' && obj instanceof fabric.Line) {
            const ends = lineWorldEndpoints(obj);
            const dx = ends.end.x - ends.start.x;
            const dy = ends.end.y - ends.start.y;
            const len = Math.hypot(dx, dy);
            if (len < 4) continue;
            const mid = {
              x: (ends.start.x + ends.end.x) / 2,
              y: (ends.start.y + ends.end.y) / 2,
            };
            const midScreen = screenFromWorld(mid);
            // Perpendicular offset (in screen px) so the label sits beside
            // the wall, not on top of it.
            const perp = { x: -dy / len, y: dx / len };
            const offset = 16;
            next.push(
              makeLabel(formatLength(len), {
                x: midScreen.x + perp.x * offset,
                y: midScreen.y + perp.y * offset,
              }),
            );
          } else if (k === 'furniture' && obj instanceof fabric.Group) {
            // Furniture group's left/top are the world centre (CENTER origin).
            const cx = obj.left ?? 0;
            const cy = obj.top ?? 0;
            const w = (obj.width ?? 0) * (obj.scaleX ?? 1);
            const h = (obj.height ?? 0) * (obj.scaleY ?? 1);
            const labelScreen = screenFromWorld({ x: cx, y: cy + h / 2 });
            next.push(
              makeLabel(`${formatLength(w)} × ${formatLength(h)}`, {
                x: labelScreen.x,
                y: labelScreen.y + 12,
              }),
            );
          }
        }
        layer.replaceChildren(...next);
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
          if (!editingRef.current) return;
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
        // Joins are an editing affordance (click to disconnect). In
        // read-only mode they're noise — they overlap with dimension
        // labels and clutter the view at every zoom level — so hide
        // every join element and exit early. We still keep the joins
        // array warm so toggling back into edit mode is instant.
        const interactive = editingRef.current && modeRef.current === 'select';
        if (!editingRef.current) {
          for (const el of joinEls) {
            if (el) el.style.display = 'none';
          }
          return;
        }
        // Hide unused join elements
        for (let i = joins.length; i < joinEls.length; i++) {
          if (joinEls[i]) joinEls[i]!.style.display = 'none';
        }
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

      // ─── Closed-room shading ────────────────────────────────────────────
      // Fill any sealed wall loop with a subtle tint so the caregiver gets
      // visual confirmation the walls really do enclose an area.
      function renderShading() {
        const svg = shadingLayerRef.current;
        if (!svg) return;
        const rooms = findClosedRooms(canvas);
        if (rooms.length === 0) {
          if (svg.firstChild) svg.replaceChildren();
          return;
        }
        const SVG_NS = 'http://www.w3.org/2000/svg';
        // Rebuild children rather than diff — there are typically only a
        // handful of rooms and the operation runs at canvas-render rate,
        // not per-frame keystroke.
        const next = rooms.map((verts) => {
          const points = verts
            .map((p) => {
              const s = screenFromWorld(p);
              return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
            })
            .join(' ');
          const el = document.createElementNS(SVG_NS, 'polygon');
          el.setAttribute('points', points);
          el.setAttribute('fill', ROOM_FILL);
          el.setAttribute('stroke', 'none');
          return el;
        });
        svg.replaceChildren(...next);
      }

      // ─── F6 beacon overlay ──────────────────────────────────────────────
      // Beacons render as DOM nodes on a dedicated layer (mirrors the
      // joins overlay). They live in the same coordinate space as the
      // canvas via screenFromWorld, so they ride along with zoom + pan
      // without being baked into Fabric's render loop. Drag of an already-
      // placed beacon updates its position in-place and fires onBeaconUpdate
      // on pointer-up; click on the canvas while armed drops the armed
      // beacon at the click coords.
      let beaconSprites: BeaconSprite[] = [];
      let armedBeaconId: string | null = null;

      const applyArmedCursor = () => {
        if (modeRef.current !== 'beacon-placement') return;
        canvas.defaultCursor = armedBeaconId ? 'crosshair' : 'default';
        canvas.hoverCursor = canvas.defaultCursor;
      };

      function renderBeacons() {
        const layer = beaconsLayerRef.current;
        if (!layer) return;
        // Beacons render in beacon-placement (draggable) AND calibration
        // (read-only — caregivers need to see beacons as visual context
        // when capturing fingerprints) modes. Hidden in everything else
        // so they don't clutter the editor.
        const m = modeRef.current;
        if (m !== 'beacon-placement' && m !== 'calibration') {
          layer.replaceChildren();
          return;
        }
        const placed = beaconSprites.filter((s) => s.x != null && s.y != null);
        const next = placed.map((sprite) => makeBeaconEl(sprite));
        layer.replaceChildren(...next);
      }

      function makeBeaconEl(sprite: BeaconSprite): HTMLDivElement {
        const screen = screenFromWorld({ x: sprite.x!, y: sprite.y! });
        const el = document.createElement('div');
        // In calibration mode the beacon DOM is inert: pointer-events-none
        // and no grab cursor, so the click passes through to the canvas
        // and lands on the calibration-click handler below.
        const interactive = modeRef.current === 'beacon-placement';
        el.className = interactive
          ? 'pointer-events-auto absolute z-30 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[9px] font-semibold text-white shadow'
          : 'pointer-events-none absolute z-30 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-emerald-500/80 text-[9px] font-semibold text-white shadow';
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        el.title = interactive ? `${sprite.label} · drag to move` : sprite.label;
        el.dataset.beaconId = sprite.id;
        // Inline initial — first letter of the label, falls back to dot.
        el.textContent = sprite.label.trim().charAt(0).toUpperCase() || '•';
        if (interactive) attachBeaconDrag(el, sprite.id);
        return el;
      }

      function attachBeaconDrag(el: HTMLDivElement, beaconId: string) {
        el.addEventListener('pointerdown', (e) => {
          if (modeRef.current !== 'beacon-placement') return;
          e.preventDefault();
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          el.style.cursor = 'grabbing';

          const onMove = (ev: PointerEvent) => {
            const rect = canvas.upperCanvasEl.getBoundingClientRect();
            const sx = ev.clientX - rect.left;
            const sy = ev.clientY - rect.top;
            const w = worldFromScreen(sx, sy);
            const target = { x: snap(w.x), y: snap(w.y) };
            // Mutate the in-memory sprite + DOM directly during drag so
            // the visual moves smoothly. Persist on pointerup.
            const sprite = beaconSprites.find((s) => s.id === beaconId);
            if (!sprite) return;
            sprite.x = target.x;
            sprite.y = target.y;
            const screen = screenFromWorld(target);
            el.style.left = `${screen.x}px`;
            el.style.top = `${screen.y}px`;
          };

          const onUp = () => {
            el.releasePointerCapture(e.pointerId);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.style.cursor = 'grab';
            const sprite = beaconSprites.find((s) => s.id === beaconId);
            if (sprite && sprite.x != null && sprite.y != null) {
              onBeaconUpdateRef.current?.(beaconId, sprite.x, sprite.y);
            }
          };

          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup', onUp);
        });
      }

      // ─── F7 calibration-points overlay ──────────────────────────────────
      // Same DOM-overlay pattern as F6 beacons. Sprites with `pending:
      // true` render dashed + lower opacity to convey "not yet captured";
      // already-placed sprites render solid with their derived index.
      let calibrationSprites: CalibrationPointSprite[] = [];
      let armedCalibration = false;

      const applyCalibrationCursor = () => {
        if (modeRef.current !== 'calibration') return;
        canvas.defaultCursor = armedCalibration ? 'crosshair' : 'default';
        canvas.hoverCursor = canvas.defaultCursor;
      };

      function renderCalibrationPoints() {
        const layer = calibrationLayerRef.current;
        if (!layer) return;
        if (modeRef.current !== 'calibration') {
          layer.replaceChildren();
          return;
        }
        const next = calibrationSprites.map((sprite) => makeCalibrationEl(sprite));
        layer.replaceChildren(...next);
      }

      function makeCalibrationEl(sprite: CalibrationPointSprite): HTMLDivElement {
        const screen = screenFromWorld({ x: sprite.x, y: sprite.y });
        const el = document.createElement('div');
        const base =
          'pointer-events-none absolute z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] font-semibold text-white shadow';
        el.className = sprite.pending
          ? `${base} border-2 border-dashed border-white bg-amber-500/70`
          : `${base} border-2 border-white bg-sky-500`;
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        el.title = sprite.pending
          ? 'Pending capture — press Capture to start the sample window'
          : `Calibration point ${sprite.index}`;
        el.textContent = sprite.pending ? '·' : String(sprite.index);
        return el;
      }

      // ─── F8 patient marker (live position) ──────────────────────────────
      // Single DOM node repositioned in place as new estimates arrive.
      // CSS handles the tween (200 ms ease-out on transform + opacity)
      // so a 1 Hz update stream looks smooth without per-frame work.
      // Opacity tracks confidence with a 0.3 floor so the marker never
      // disappears entirely — F8.md UX line.
      let markerSprite: PatientMarkerSprite | null = null;
      let markerEl: HTMLDivElement | null = null;
      const MIN_MARKER_OPACITY = 0.3;

      function ensureMarkerEl(): HTMLDivElement | null {
        const layer = markerLayerRef.current;
        if (!layer) return null;
        if (markerEl) return markerEl;
        markerEl = document.createElement('div');
        markerEl.className =
          'pointer-events-auto absolute z-30 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 shadow ring-2 ring-rose-500/30';
        markerEl.style.transition = 'left 200ms ease-out, top 200ms ease-out, opacity 200ms';
        layer.appendChild(markerEl);
        return markerEl;
      }

      function renderMarker() {
        if (markerSprite == null) {
          if (markerEl) {
            markerEl.style.display = 'none';
          }
          return;
        }
        const el = ensureMarkerEl();
        if (!el) return;
        const screen = screenFromWorld({ x: markerSprite.x, y: markerSprite.y });
        const opacity = Math.max(MIN_MARKER_OPACITY, Math.min(1, markerSprite.confidence));
        el.style.display = 'block';
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        el.style.opacity = String(opacity);
        // Item 94: amber stale ring overlay when isStale; matches
        // map/PatientPin's 30-second threshold treatment.
        const isStale = markerSprite.isStale === true;
        el.style.boxShadow = isStale
          ? '0 0 0 4px rgba(245, 158, 11, 0.55), 0 1px 2px rgba(0,0,0,0.18)'
          : '0 1px 2px rgba(0,0,0,0.18)';
        el.title = isStale
          ? `Position (stale > 30 s) · confidence ${(markerSprite.confidence * 100).toFixed(0)}% · ${markerSprite.recorded_at}`
          : `Position · confidence ${(markerSprite.confidence * 100).toFixed(0)}% · ${markerSprite.recorded_at}`;
      }

      // ─── F13 replay dots ────────────────────────────────────────────────
      // Keyed map so diff-removal is O(1). Entries are DOM divs positioned
      // in the same coordinate space as the other overlays.
      const replayDotEls = new Map<string, HTMLDivElement>();

      function makeReplayDotEl(sprite: ReplayDotSprite): HTMLDivElement {
        const screen = screenFromWorld({ x: sprite.x, y: sprite.y });
        const el = document.createElement('div');
        el.className =
          'pointer-events-none absolute z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 shadow-sm';
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y}px`;
        el.style.opacity = String(Math.max(0.15, Math.min(1, sprite.alpha)));
        return el;
      }

      function applyReplayDots(sprites: ReplayDotSprite[]) {
        const layer = replayDotsLayerRef.current;
        if (!layer) return;
        const nextKeys = new Set(sprites.map((s) => s.key));
        // Remove dots that are no longer in the trail.
        for (const [key, el] of replayDotEls) {
          if (!nextKeys.has(key)) {
            el.remove();
            replayDotEls.delete(key);
          }
        }
        // Add new dots.
        for (const sprite of sprites) {
          if (!replayDotEls.has(sprite.key)) {
            const el = makeReplayDotEl(sprite);
            layer.appendChild(el);
            replayDotEls.set(sprite.key, el);
          } else {
            // Reposition in case viewport changed (pan/zoom).
            const el = replayDotEls.get(sprite.key)!;
            const screen = screenFromWorld({ x: sprite.x, y: sprite.y });
            el.style.left = `${screen.x}px`;
            el.style.top = `${screen.y}px`;
            el.style.opacity = String(Math.max(0.15, Math.min(1, sprite.alpha)));
          }
        }
      }

      // ─── Pointer handlers ───────────────────────────────────────────────
      const handlePointerDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        // Beacon placement is the one mode where clicks matter even when
        // the canvas is read-only (`!editingRef.current`). Drop the armed
        // beacon at the click coords, then disarm.
        if (modeRef.current === 'beacon-placement') {
          if (!armedBeaconId) return;
          const raw = canvas.getScenePoint(opt.e);
          const sp = { x: snap(raw.x), y: snap(raw.y) };
          const id = armedBeaconId;
          armedBeaconId = null;
          applyArmedCursor();
          onBeaconUpdateRef.current?.(id, sp.x, sp.y);
          return;
        }
        // F7 calibration: same pattern, fires onCalibrationClick instead.
        // Disarm is parent's job (the panel sets pending on click and
        // flips armed off until the pending dot is cleared).
        if (modeRef.current === 'calibration') {
          if (!armedCalibration) return;
          const raw = canvas.getScenePoint(opt.e);
          const sp = { x: snap(raw.x), y: snap(raw.y) };
          onCalibrationClickRef.current?.(sp.x, sp.y);
          return;
        }
        if (!interactiveRef.current) return;
        if (!editingRef.current) return;
        const e = opt.e as MouseEvent;

        if (spaceHeldRef.current) {
          panningRef.current = true;
          panOriginRef.current = { x: e.clientX, y: e.clientY };
          canvas.setCursor('grabbing');
          return;
        }

        const mode = modeRef.current;
        // Connected-wall capture happens lazily on the first
        // object:moving event using fabric's transform.original. Doing
        // it here was racing with Fabric's internal selection /
        // hit-test sequence and missing the click in some cases.
        if (mode === 'select') return;

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

      // Wipe every kind-tagged object (walls, rooms, furniture) plus any
      // in-progress draft. Pushes a snapshot afterwards so a misclick can
      // be recovered with Cmd+Z. Note we do NOT touch scale_meters_per_pixel
      // — that lives on the floor_plans row, not on the canvas, and the
      // caregiver typically wants to redraw on the same calibration. F6
      // beacons reference floor_plan_id with their own (x_canvas, y_canvas)
      // — clearing geometry doesn't auto-delete them; that's a deliberate
      // separation per CROSS_CUTTING §6.
      const clearAll = () => {
        if (!editingRef.current) return;
        cancelWallDraft();
        cancelPolygonDraft();
        canvas.discardActiveObject();
        const tagged = canvas.getObjects().filter((o) => kindOf(o));
        if (tagged.length === 0) return;
        for (const o of tagged) canvas.remove(o);
        // Item 153: don't reset the viewport transform on clear. The
        // caregiver's pan/zoom is independent of object content, and the
        // dialog already promises "you can recover with Cmd/Ctrl+Z"; that
        // promise is undermined if Reset also resets the camera. Pan/zoom
        // survives the clear; objects are gone but the framing stays.
        canvas.requestRenderAll();
        emitDirty();
        emitEmpty();
        emitSelection();
        snapshot();
        updateGrid();
        renderHandles();
        renderLabelsAndJoins();
        renderShading();
      };

      Object.assign(canvas as unknown as Record<string, unknown>, {
        __fpClearAll: clearAll,
        __fpSetBeacons: (sprites: BeaconSprite[]) => {
          beaconSprites = sprites;
          renderBeacons();
        },
        __fpArmPlacement: (id: string | null) => {
          armedBeaconId = id;
          applyArmedCursor();
        },
        __fpSetCalibrationPoints: (sprites: CalibrationPointSprite[]) => {
          calibrationSprites = sprites;
          renderCalibrationPoints();
        },
        __fpArmCalibration: (armed: boolean) => {
          armedCalibration = armed;
          applyCalibrationCursor();
        },
        __fpSetPatientMarker: (sprite: PatientMarkerSprite | null) => {
          markerSprite = sprite;
          renderMarker();
        },
        __fpSetReplayDots: (sprites: ReplayDotSprite[]) => {
          applyReplayDots(sprites);
        },
      });

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
      // Capture state on selection — fabric just made the wall active
      // and hasn't started any drag, so left/top are the pre-drag
      // position and followers are still at their original spots.
      // Doing this in mouse:down was racing with Fabric's hit-test;
      // doing it in object:moving was reading mid-drag positions for
      // some flows.
      const captureTranslateState = (target: fabric.Object | null | undefined) => {
        if (!editingRef.current || !target) {
          translateRef.current = null;
          return;
        }
        if (target instanceof fabric.Line && kindOf(target) === 'wall') {
          const group = findConnectedWallGroup(canvas, target);
          translateRef.current = {
            wall: target,
            startCenter: { x: target.left ?? 0, y: target.top ?? 0 },
            followers: group
              .filter((w) => w !== target)
              .map((w) => ({
                wall: w,
                startCenter: { x: w.left ?? 0, y: w.top ?? 0 },
              })),
          };
        } else {
          translateRef.current = null;
        }
      };

      canvas.on('object:moving', (opt: { target?: fabric.Object }) => {
        const t = opt.target;
        const state = translateRef.current;
        if (!t || !state || state.wall !== t) return;
        if (!editingRef.current) return;
        const dx = (t.left ?? 0) - state.startCenter.x;
        const dy = (t.top ?? 0) - state.startCenter.y;
        for (const f of state.followers) {
          f.wall.set({
            left: f.startCenter.x + dx,
            top: f.startCenter.y + dy,
          });
          f.wall.setCoords();
        }
        // Defensive — fabric requestRenderAll runs after our handler in
        // most paths, but make it explicit so followers always paint.
        canvas.requestRenderAll();
        renderHandles();
        renderLabelsAndJoins();
        renderShading();
      });

      const handleObjectModified = (opt: { target?: fabric.Object }) => {
        if (!interactiveRef.current || replayingRef.current) return;
        const t = opt.target;
        if (t instanceof fabric.Line && kindOf(t) === 'wall') {
          canonicaliseLine(t);
          // Also canonicalise every follower that was translated during
          // the drag so their stored x1/y1/x2/y2 stay in world space.
          if (translateRef.current && translateRef.current.wall === t) {
            for (const f of translateRef.current.followers) canonicaliseLine(f.wall);
          }
        } else if (t instanceof fabric.Polygon && kindOf(t) === 'room') {
          setPolygonVertices(t, polygonWorldVertices(t));
        }
        // Re-capture from the *new* positions so a subsequent drag of
        // the same wall (without deselecting first) still finds the
        // group and the right anchor centres.
        captureTranslateState(canvas.getActiveObject());
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
        renderShading();
      });
      canvas.on('object:removed', () => {
        emitEmpty();
        // Label pool is index-based — the next renderLabels claims only
        // as many slots as live objects need and hides the rest.
        renderHandles();
        renderLabelsAndJoins();
        renderShading();
      });
      canvas.on('after:render', () => {
        updateGrid();
        renderHandles();
        renderLabelsAndJoins();
        renderShading();
        renderBeacons();
        renderCalibrationPoints();
        renderMarker();
      });
      canvas.on('selection:created', () => {
        emitSelection();
        renderHandles();
        captureTranslateState(canvas.getActiveObject());
      });
      canvas.on('selection:updated', () => {
        emitSelection();
        renderHandles();
        captureTranslateState(canvas.getActiveObject());
      });
      canvas.on('selection:cleared', () => {
        emitSelection();
        renderHandles();
        translateRef.current = null;
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

      if (initialJson != null) {
        // Phase F item 48: gate loadFromJSON on a Zod structural check
        // so a malformed canvas_json (corrupt jsonb, partial migration,
        // future schema drift) falls back to an empty canvas with a
        // console warn instead of leaving Fabric in a broken state.
        const parsed = parseCanvasJson(initialJson);
        if (!parsed.ok) {
          console.warn('floor-plan: rejected canvas_json —', parsed.error);
          finishLoad();
        } else {
          canvas
            .loadFromJSON(parsed.json as unknown as Record<string, unknown>)
            .then(finishLoad)
            .catch((err) => {
              if (disposed) return;
              console.error('floor-plan: loadFromJSON failed', err);
              interactiveRef.current = true;
              historyRef.current = { stack: [canvas.toObject(EXTRA_PROPS)], idx: 0 };
            });
        }
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
        // Beacon-placement / calibration modes run alongside the F5
        // canvas (e.g. when sub-tabs are mounted concurrently). The F5
        // keyboard shortcuts (Backspace = delete, Cmd+Z = undo, Cmd+A =
        // select all, etc.) shouldn't fire from those sub-tabs — only
        // Esc, which disarms a pending action.
        if (modeRef.current === 'beacon-placement') {
          if (e.key === 'Escape' && armedBeaconId) {
            armedBeaconId = null;
            applyArmedCursor();
          }
          return;
        }
        if (modeRef.current === 'calibration') {
          if (e.key === 'Escape' && armedCalibration) {
            armedCalibration = false;
            applyCalibrationCursor();
          }
          return;
        }
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
        for (const el of joinEls) el.remove();
        // Label DOM lives inside the React-managed labelsLayerRef div,
        // so React unmounts the whole layer when the component dies —
        // no manual teardown needed here.
        canvas.dispose();
        fabricRef.current = null;
      };
      // Deps intentionally empty — the Fabric canvas is created once on
      // mount. initialJson is loaded once via the inner replay; scale and
      // showDimensions are read via refs; size changes flow through
      // canvas.setDimensions in a separate effect below (re-creating the
      // canvas on every resize would lose history + selection state).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the Fabric pixel buffer in sync with the wrapper's measured
    // size. setDimensions updates both the bitmap and the CSS box without
    // disposing the canvas, so undo history, selection, and viewport
    // transform survive a resize.
    useEffect(() => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.setDimensions({ width: canvasWidth, height: canvasHeight });
      canvas.requestRenderAll();
    }, [canvasWidth, canvasHeight]);

    // Observe the wrapper when no explicit pixel dims are supplied. This
    // is the path the editor page uses — the wrapper fills its CSS box
    // (page width × viewport-relative height) and we feed those measured
    // dims into the Fabric canvas.
    useEffect(() => {
      if (explicitDims) return;
      const el = wrapperRef.current;
      if (!el) return;
      const apply = () => {
        const r = el.getBoundingClientRect();
        const w = Math.max(1, Math.floor(r.width));
        const h = Math.max(1, Math.floor(r.height));
        setMeasured((prev) =>
          prev.width === w && prev.height === h ? prev : { width: w, height: h },
        );
      };
      apply();
      const obs = new ResizeObserver(apply);
      obs.observe(el);
      return () => obs.disconnect();
    }, [explicitDims]);

    useImperativeHandle(
      ref,
      () => ({
        setMode: (mode, kind) => {
          const prevMode = modeRef.current;
          modeRef.current = mode;
          if (kind) furnitureKindRef.current = kind;
          const canvas = fabricRef.current;
          if (!canvas) return;
          const interactive = editingRef.current && mode === 'select';
          canvas.selection = interactive;
          // Beacon-placement / calibration: cursor stays default until
          // armed (handled inside the heavy effect via the *Cursor
          // helpers). Drawing modes (wall/room/polygon/furniture) use
          // crosshair to convey "click here to draw".
          canvas.defaultCursor =
            mode === 'select' || mode === 'beacon-placement' || mode === 'calibration'
              ? 'default'
              : 'crosshair';
          // In drawing modes, prevent fabric from intercepting clicks on
          // existing geometry (so a wall-mode click on an existing wall's
          // endpoint starts a new wall instead of selecting the old one).
          // In read-only mode, nothing is selectable regardless of mode.
          for (const obj of canvas.getObjects()) {
            if (kindOf(obj)) obj.evented = interactive;
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
        clearAll: () => {
          const c = fabricRef.current as unknown as { __fpClearAll?: () => void } | null;
          c?.__fpClearAll?.();
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
        setBeacons: (sprites) => {
          const c = fabricRef.current as unknown as {
            __fpSetBeacons?: (sprites: BeaconSprite[]) => void;
          } | null;
          c?.__fpSetBeacons?.(sprites);
        },
        armPlacement: (id) => {
          const c = fabricRef.current as unknown as {
            __fpArmPlacement?: (id: string | null) => void;
          } | null;
          c?.__fpArmPlacement?.(id);
        },
        setCalibrationPoints: (sprites) => {
          const c = fabricRef.current as unknown as {
            __fpSetCalibrationPoints?: (sprites: CalibrationPointSprite[]) => void;
          } | null;
          c?.__fpSetCalibrationPoints?.(sprites);
        },
        armCalibrationCapture: (armed) => {
          const c = fabricRef.current as unknown as {
            __fpArmCalibration?: (armed: boolean) => void;
          } | null;
          c?.__fpArmCalibration?.(armed);
        },
        setPatientMarker: (sprite) => {
          const c = fabricRef.current as unknown as {
            __fpSetPatientMarker?: (sprite: PatientMarkerSprite | null) => void;
          } | null;
          c?.__fpSetPatientMarker?.(sprite);
        },
        setReplayDots: (sprites) => {
          const c = fabricRef.current as unknown as {
            __fpSetReplayDots?: (sprites: ReplayDotSprite[]) => void;
          } | null;
          c?.__fpSetReplayDots?.(sprites);
        },
      }),
      [],
    );

    return (
      <div
        ref={wrapperRef}
        role="img"
        aria-label={ariaLabel ?? 'Floor plan canvas'}
        className={cn(
          'relative overflow-hidden rounded-lg border border-border bg-card touch-pan-x touch-pan-y',
          !explicitDims && 'h-full w-full',
          className,
        )}
        style={explicitDims ? { width, height } : undefined}
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
        <svg
          ref={shadingLayerRef}
          className="pointer-events-none absolute inset-0 z-5"
          width={canvasWidth}
          height={canvasHeight}
        />
        <canvas
          ref={canvasElRef}
          width={canvasWidth}
          height={canvasHeight}
          className="relative z-10"
        />
        <div ref={labelsLayerRef} className="pointer-events-none absolute inset-0 z-25" />
        <div ref={handlesLayerRef} className="pointer-events-none absolute inset-0 z-30" />
        <div ref={joinsLayerRef} className="pointer-events-none absolute inset-0 z-22" />
        {/* z-30: above shading + labels, alongside endpoint handles. The
            children themselves carry pointer-events-auto so beacons are
            draggable while the layer stays inert under read-only modes. */}
        <div ref={beaconsLayerRef} className="pointer-events-none absolute inset-0 z-30" />
        {/* z-30 sibling: calibration points. Children are pointer-events-
            none so clicks pass through to the canvas, where the
            handlePointerDown calibration branch routes them. */}
        <div ref={calibrationLayerRef} className="pointer-events-none absolute inset-0 z-30" />
        {/* z-30 sibling: live patient marker. Single child div with a
            CSS transition so 1 Hz updates feel smooth. */}
        <div ref={markerLayerRef} className="pointer-events-none absolute inset-0 z-30" />
        {/* z-31: replay trail dots. Each dot is a small DOM div so the
            scrubber can remove them individually without touching the
            Fabric object list. Sits above the marker so the current
            playback head is always visible. */}
        <div ref={replayDotsLayerRef} className="pointer-events-none absolute inset-0 z-31" />
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
