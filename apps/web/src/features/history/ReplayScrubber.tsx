import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { History as HistoryIcon } from 'lucide-react';
import { MAX_HISTORY_ROWS, usePositionHistory } from '@/lib/queries/history';
import { formatAppTz } from '@/lib/time';
import type { ReplayDotSprite } from '@/features/floor-plan/types';
import type { PositionHistoryRow } from './types';
import type { DateRange } from './types';
import { ReplayCanvas } from './ReplayCanvas';
import type { ReplayCanvasHandle } from './ReplayCanvas';

interface Props {
  patientId: string;
  range: DateRange;
  canvasJson: unknown;
  scaleMetersPerPixel: number | null;
}

// Trail window: dots within this many milliseconds of the current
// playhead are rendered. Dots older than this are removed immediately.
const TRAIL_MS = 60_000;

const SPEED_OPTIONS = [10, 60, 300] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

// Phase F item 50: when the gap between two consecutive rows exceeds
// this many ms (in replay-real-time, i.e. wall-clock × speed), snap
// the playhead forward instead of waiting through it. Caregivers see
// the slider + timestamp jump (which makes the gap obvious) without
// having to wait through an overnight pause at any speed. Setting this
// to Infinity gives a strict "1× = real-time" replay.
const QUIET_SKIP_MS = 30_000;

// Only indoor rows with valid canvas coords are usable for replay.
function isReplayable(row: PositionHistoryRow): row is PositionHistoryRow & {
  x_canvas: number;
  y_canvas: number;
} {
  return row.mode === 'indoor' && row.x_canvas != null && row.y_canvas != null;
}

export function ReplayScrubber({ patientId, range, canvasJson, scaleMetersPerPixel }: Props) {
  const query = usePositionHistory(patientId, range);
  const canvasRef = useRef<ReplayCanvasHandle | null>(null);

  // Filtered, time-ordered indoor rows.
  const rows = useRef<PositionHistoryRow[]>([]);

  // Scrubber state. idx is the index of the *current* row (the leading
  // edge of the playhead); -1 means "before the start". headTimeMs is
  // the playhead expressed in row-time coordinates so a single-tick
  // advance moves a constant number of *recorded* milliseconds rather
  // than averaging across the whole range — gaps in the data render as
  // visible gaps in the slider movement.
  const [idx, setIdx] = useState(-1);
  const idxRef = useRef(-1);
  const headTimeRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [speed, setSpeed] = useState<Speed>(60);
  const speedRef = useRef<Speed>(60);

  // Item 115: rows-array swap + idx reset are coordinated in a single
  // effect so a refetch can never expose the RAF loop to "new rows with
  // old idx" for one frame. We hash the dataset's edges (length, first,
  // last recorded_at); a noop refetch (same hash) skips the reset, so
  // resuming play after a stale-time revalidation doesn't lose position.
  const lastHashRef = useRef<string | null>(null);
  useEffect(() => {
    const filtered = (query.data ?? []).filter(isReplayable);
    const hash = filtered.length === 0
      ? 'empty'
      : `${filtered.length}-${filtered[0]?.recorded_at}-${filtered[filtered.length - 1]?.recorded_at}`;
    rows.current = filtered;
    if (lastHashRef.current === hash) return;
    lastHashRef.current = hash;
    setIdx(-1);
    idxRef.current = -1;
    setPlaying(false);
    playingRef.current = false;
    headTimeRef.current = 0;
    canvasRef.current?.setReplayDots([]);
  }, [query.data]);

  // Push the current trail to the canvas whenever idx changes.
  const renderTrail = useCallback((currentIdx: number) => {
    const all = rows.current;
    if (all.length === 0 || currentIdx < 0) {
      canvasRef.current?.setReplayDots([]);
      return;
    }
    const head = all[currentIdx];
    if (!head) return;
    const headMs = new Date(head.recorded_at).getTime();
    const cutoffMs = headMs - TRAIL_MS;

    const sprites: ReplayDotSprite[] = [];
    for (let i = currentIdx; i >= 0; i--) {
      const row = all[i]!;
      if (!isReplayable(row)) continue;
      const rowMs = new Date(row.recorded_at).getTime();
      if (rowMs < cutoffMs) break;
      // Age within trail: 0 = freshest (the head), 1 = oldest edge.
      const age = (headMs - rowMs) / TRAIL_MS;
      sprites.push({
        key: `${row.recorded_at}-${i}`,
        x: row.x_canvas as number,
        y: row.y_canvas as number,
        alpha: 1 - age * 0.85,
      });
    }
    canvasRef.current?.setReplayDots(sprites);
  }, []);

  // Phase F item 50: RAF loop drives `headTimeMs` (in row-time
  // coordinates) forward by `wallDelta × speed` ms each tick. The
  // visible idx is whatever row's recorded_at most recently fell at or
  // before headTime. A long gap to the next row blocks idx advancement
  // for the duration of that gap (real-time × speed) — except when the
  // gap exceeds QUIET_SKIP_MS replay-real-time, in which case the
  // playhead snaps forward to the next row. That makes overnight gaps
  // visible without making them painful.
  const rafRef = useRef<number | null>(null);
  const lastRafTs = useRef<number | null>(null);
  // Item 124: throttle setReplayDots / Fabric mutation to once per
  // ~50 ms even though idx state can update at full rate. At 300×
  // playback this caps Fabric ops at ~20/s × trail size instead of
  // 25/s × trail size, which keeps the demo path smooth on slower
  // laptops without losing perceived smoothness.
  const lastTrailRenderMs = useRef<number>(0);
  const TRAIL_THROTTLE_MS = 50;

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastRafTs.current = null;
  }, []);

  const startRaf = useCallback(() => {
    stopRaf();

    const tick = (nowMs: number) => {
      if (!playingRef.current) return;

      const last = lastRafTs.current ?? nowMs;
      const wallDelta = nowMs - last;
      lastRafTs.current = nowMs;

      const currentRows = rows.current;
      if (currentRows.length === 0) {
        stopRaf();
        return;
      }

      // Initialise the playhead on first tick from the current idx.
      // Item 116: defensive check — a refetch race could leave us with
      // a startIdx that's out of bounds. Bail rather than throw.
      if (headTimeRef.current === 0) {
        const startIdx = Math.max(0, idxRef.current);
        const startRow = currentRows[startIdx];
        if (!startRow) {
          stopRaf();
          return;
        }
        headTimeRef.current = new Date(startRow.recorded_at).getTime();
      }

      const advance = wallDelta * speedRef.current;
      headTimeRef.current += advance;

      // Walk idx forward while the playhead has crossed subsequent rows.
      let nextIdx = idxRef.current;
      while (nextIdx < currentRows.length - 1) {
        const nextRow = currentRows[nextIdx + 1]!;
        const nextRowMs = new Date(nextRow.recorded_at).getTime();
        if (headTimeRef.current >= nextRowMs) {
          nextIdx += 1;
          continue;
        }
        // Playhead sits in a gap before nextRow. If the remaining gap
        // exceeds QUIET_SKIP_MS in replay-real-time (i.e. wall seconds
        // at the current speed), snap forward instead of waiting.
        const remainingMs = nextRowMs - headTimeRef.current;
        if (remainingMs / speedRef.current > QUIET_SKIP_MS) {
          headTimeRef.current = nextRowMs;
          nextIdx += 1;
          continue;
        }
        break;
      }

      if (nextIdx !== idxRef.current) {
        idxRef.current = nextIdx;
        setIdx(nextIdx);
        // Item 124: rate-limit canvas writes; idx state still updates
        // at full rate so the scrubber + timestamp readout stay live.
        // Always render on the final tick (when the loop is about to
        // stop) so the trail reflects the playback's last moment.
        const isFinalTick = nextIdx >= currentRows.length - 1;
        if (isFinalTick || nowMs - lastTrailRenderMs.current >= TRAIL_THROTTLE_MS) {
          lastTrailRenderMs.current = nowMs;
          renderTrail(nextIdx);
        }
      }

      if (nextIdx >= currentRows.length - 1) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf, renderTrail]);

  const togglePlay = useCallback(() => {
    // Item 116: empty-rows guard. A refetch race or refresh-while-paused
    // can leave us with no replayable rows; pressing Play would then
    // crash on the headTime initialisation. Bail with a no-op.
    if (rows.current.length === 0) return;

    const wasPlaying = playingRef.current;
    playingRef.current = !wasPlaying;
    setPlaying(!wasPlaying);

    if (!wasPlaying) {
      // If at the end, restart from the beginning.
      if (idxRef.current >= rows.current.length - 1) {
        idxRef.current = 0;
        setIdx(0);
        const first = rows.current[0];
        if (!first) {
          playingRef.current = false;
          setPlaying(false);
          return;
        }
        headTimeRef.current = new Date(first.recorded_at).getTime();
        renderTrail(0);
      } else {
        // Re-anchor the playhead to whatever row we paused at — avoids
        // a jump if the user paused, scrubbed, then resumed.
        const startIdx = Math.max(0, idxRef.current);
        const startRow = rows.current[startIdx];
        if (startRow) headTimeRef.current = new Date(startRow.recorded_at).getTime();
      }
      startRaf();
    } else {
      stopRaf();
    }
  }, [startRaf, stopRaf, renderTrail]);

  // Keyboard shortcuts on the slider (space, ←/→, shift+←/→).
  const onSliderKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const total = rows.current.length;
      if (total === 0) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }

      let delta = 0;
      if (e.key === 'ArrowLeft') delta = e.shiftKey ? -10 : -1;
      else if (e.key === 'ArrowRight') delta = e.shiftKey ? 10 : 1;
      else return;

      e.preventDefault();
      stopRaf();
      playingRef.current = false;
      setPlaying(false);

      const next = Math.max(0, Math.min(total - 1, idxRef.current + delta));
      idxRef.current = next;
      setIdx(next);
      const nextRow = rows.current[next];
      if (nextRow) headTimeRef.current = new Date(nextRow.recorded_at).getTime();
      renderTrail(next);
    },
    [togglePlay, stopRaf, renderTrail],
  );

  // Drag/click on the slider input.
  const onSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      stopRaf();
      playingRef.current = false;
      setPlaying(false);
      const next = Number(e.target.value);
      idxRef.current = next;
      setIdx(next);
      const nextRow = rows.current[next];
      if (nextRow) headTimeRef.current = new Date(nextRow.recorded_at).getTime();
      renderTrail(next);
    },
    [stopRaf, renderTrail],
  );

  const onSpeedChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value) as Speed;
    speedRef.current = v;
    setSpeed(v);
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => stopRaf(), [stopRaf]);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="aspect-[4/3] max-h-[720px] min-h-[280px] sm:min-h-[420px] w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <EmptyState
        icon={<HistoryIcon className="h-10 w-10" />}
        title="Failed to load movement history"
        description="Check your connection and try refreshing."
      />
    );
  }

  const indoorRows = (query.data ?? []).filter(isReplayable);
  if (indoorRows.length === 0) {
    return (
      <EmptyState
        icon={<HistoryIcon className="h-10 w-10" />}
        title="No indoor movement in this window"
        description="There are no indoor position estimates for the selected date range."
      />
    );
  }

  const total = indoorRows.length;
  const currentRow = idx >= 0 ? indoorRows[idx] : null;
  // Item 101: timestamp readout in AEST so the value matches the badge
  // claim in DateRangePicker regardless of the presenter machine's TZ.
  const timestamp = currentRow
    ? formatAppTz(currentRow.recorded_at, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '—';
  // Item 117: surface a notice when the server cap clipped the window.
  const truncated = (query.data?.length ?? 0) >= MAX_HISTORY_ROWS;

  return (
    <div className="space-y-3">
      {truncated && (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
        >
          Showing first {MAX_HISTORY_ROWS.toLocaleString()} rows · narrow the window for full coverage.
        </p>
      )}
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          onClick={togglePlay}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Speed
          <select
            value={speed}
            onChange={onSpeedChange}
            className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {idx + 1} / {total} · {timestamp}
        </span>
      </div>

      {/* Labelled range slider — screen readers announce position. */}
      <label className="block">
        <span className="sr-only">Playback position</span>
        {/* Item 139: keyboard-shortcut hint for SR users. */}
        <span className="sr-only">
          Use Space to play or pause, arrow keys to scrub one frame, Shift+arrow to scrub ten frames.
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.max(0, idx)}
          onChange={onSliderChange}
          onKeyDown={onSliderKeyDown}
          aria-label="Playback position"
          aria-keyshortcuts="Space ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
          aria-valuemin={0}
          aria-valuemax={total - 1}
          aria-valuenow={Math.max(0, idx)}
          className="w-full cursor-pointer accent-primary"
        />
      </label>

      {/* Canvas */}
      <div className="aspect-[4/3] max-h-[720px] min-h-[280px] sm:min-h-[420px] w-full overflow-hidden rounded-lg border border-border">
        <ReplayCanvas
          ref={canvasRef}
          canvasJson={canvasJson}
          scaleMetersPerPixel={scaleMetersPerPixel}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
