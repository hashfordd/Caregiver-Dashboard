import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { History as HistoryIcon } from 'lucide-react';
import { usePositionHistory } from '@/lib/queries/history';
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

// RAF tick interval for live playback. We advance `tickMs` of data
// per 10 ms of wall clock at 1× speed; speed multiplier scales tickMs.
const WALL_TICK_MS = 10;

const SPEED_OPTIONS = [1, 5, 10] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

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
  useEffect(() => {
    rows.current = (query.data ?? []).filter(isReplayable);
  }, [query.data]);

  // Scrubber state. idx is the index of the *current* row (the leading
  // edge of the playhead); -1 means "before the start".
  const [idx, setIdx] = useState(-1);
  const idxRef = useRef(-1);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const speedRef = useRef<Speed>(1);

  // When rows change (range change), reset to the beginning.
  useEffect(() => {
    setIdx(-1);
    idxRef.current = -1;
    setPlaying(false);
    playingRef.current = false;
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

  // RAF-based playback loop. Advances by `speed × WALL_TICK_MS` ms of
  // data per 10 ms wall clock so at 10× speed each RAF tick advances
  // 100 ms of data — matching the F13 spec (t=30 s wall → row ≈ 30).
  const rafRef = useRef<number | null>(null);
  const lastRafTs = useRef<number | null>(null);
  // Fractional row accumulator so sub-row advances don't get dropped.
  const rowDebt = useRef(0);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastRafTs.current = null;
    rowDebt.current = 0;
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

      // How many ms of recorded data to advance.
      const dataDelta = wallDelta * speedRef.current;
      const msPerRow =
        currentRows.length > 1
          ? (new Date(currentRows[currentRows.length - 1]!.recorded_at).getTime() -
              new Date(currentRows[0]!.recorded_at).getTime()) /
            (currentRows.length - 1)
          : 1000;

      rowDebt.current += dataDelta / msPerRow;
      const advance = Math.floor(rowDebt.current);
      rowDebt.current -= advance;

      if (advance === 0) {
        // Sub-row advance — queue the next frame without moving the scrubber.
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const nextIdx = Math.min(idxRef.current + advance, currentRows.length - 1);

      if (nextIdx !== idxRef.current) {
        idxRef.current = nextIdx;
        setIdx(nextIdx);
        renderTrail(nextIdx);
      }

      if (nextIdx >= currentRows.length - 1) {
        // Reached the end — pause.
        playingRef.current = false;
        setPlaying(false);
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf, renderTrail]);

  const togglePlay = useCallback(() => {
    const wasPlaying = playingRef.current;
    playingRef.current = !wasPlaying;
    setPlaying(!wasPlaying);

    if (!wasPlaying) {
      // If at the end, restart from the beginning.
      if (idxRef.current >= rows.current.length - 1) {
        idxRef.current = 0;
        setIdx(0);
        renderTrail(0);
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
        <Skeleton className="h-[min(60vh,720px)] min-h-[480px] w-full" />
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
  const timestamp = currentRow ? new Date(currentRow.recorded_at).toLocaleTimeString() : '—';

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          onClick={togglePlay}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {playing ? '⏸' : '▶'}
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
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.max(0, idx)}
          onChange={onSliderChange}
          onKeyDown={onSliderKeyDown}
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={total - 1}
          aria-valuenow={Math.max(0, idx)}
          className="w-full cursor-pointer accent-primary"
        />
      </label>

      {/* Canvas */}
      <div className="h-[min(60vh,720px)] min-h-[480px] w-full overflow-hidden rounded-lg border border-border">
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
