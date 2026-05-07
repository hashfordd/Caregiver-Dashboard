import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { forwardRef, useImperativeHandle } from 'react';
import type { ReplayCanvasHandle } from '../ReplayCanvas';
import type { ReplayDotSprite } from '@/features/floor-plan/types';
import type { PositionHistoryRow, DateRange } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const T0 = new Date('2026-01-01T12:00:00.000Z').getTime();

/** Build `count` indoor rows, 1 Hz, starting at T0. */
function makeFixture(count = 60): PositionHistoryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    recorded_at: new Date(T0 + i * 1000).toISOString(),
    mode: 'indoor' as const,
    x_canvas: 100 + i * 2,
    y_canvas: 200 + i * 2,
    lat: null,
    lng: null,
    confidence: 0.9,
  }));
}

const RANGE: DateRange = {
  preset: '1h',
  from: new Date(T0).toISOString(),
  to: new Date(T0 + 60_000).toISOString(),
};

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { usePositionHistoryMock, capturedDotCalls } = vi.hoisted(() => {
  const capturedDotCalls: ReplayDotSprite[][] = [];
  return {
    usePositionHistoryMock: vi.fn(),
    capturedDotCalls,
  };
});

vi.mock('@/lib/queries/history', () => ({
  usePositionHistory: (...args: unknown[]) => usePositionHistoryMock(...args),
  useVitalsHistory: vi.fn(),
  useAlertHistory: vi.fn(),
  filterAlerts: vi.fn(),
}));

// Stub ReplayCanvas — capture every setReplayDots call.
vi.mock('../ReplayCanvas', async () => {
  const ReplayCanvas = forwardRef<ReplayCanvasHandle, Record<string, unknown>>(
    function ReplayCanvasStub(_props, ref) {
      useImperativeHandle(
        ref,
        () => ({
          setReplayDots: (sprites: ReplayDotSprite[]) => {
            capturedDotCalls.push([...sprites]);
          },
        }),
        [],
      );
      return <div data-testid="replay-canvas-stub" />;
    },
  );
  return { ReplayCanvas };
});

// Static import — must come after vi.mock calls (Vitest hoists mocks above imports).
import { ReplayScrubber } from '../ReplayScrubber';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderScrubber(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <ReplayScrubber
        patientId="patient-1"
        range={RANGE}
        canvasJson={{ objects: [] }}
        scaleMetersPerPixel={0.014}
      />
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedDotCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReplayScrubber', () => {
  it('test 1 — renders dots in time order when played at 10× speed', async () => {
    const fixture = makeFixture(60);
    usePositionHistoryMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
    });

    // Control RAF manually so we can step the playback deterministically.
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const qc = makeQc();
    renderScrubber(qc);

    // Select 10× speed, then press play.
    const speedSelect = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(speedSelect, { target: { value: '10' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play replay/i }));
    });

    expect(rafCallbacks.length).toBeGreaterThan(0);

    // Run 30 RAF ticks: ~28 effective delta ticks × 10 ms = 280 ms wall,
    // 2800 ms data at 10× = ~2 rows from idx=-1. Enough to confirm
    // multiple rows have been emitted.
    let wallMs = 1000;
    for (let i = 0; i < 30; i++) {
      const cb = rafCallbacks.shift();
      if (!cb) break;
      await act(async () => {
        cb(wallMs);
        wallMs += 10;
      });
    }

    // The last setReplayDots call should have the head dot somewhere in
    // rows 1..5 (x_canvas = 100 + idx*2).
    const lastCall = capturedDotCalls.at(-1);
    expect(lastCall).toBeTruthy();
    const headDot = lastCall![0];
    expect(headDot).toBeTruthy();

    const impliedIdx = (headDot!.x - 100) / 2;
    expect(impliedIdx).toBeGreaterThanOrEqual(1);
    expect(impliedIdx).toBeLessThanOrEqual(5);

    // Trail is ordered newest → oldest (head first), so x should be
    // non-increasing across the array.
    if (lastCall!.length > 1) {
      expect(lastCall![0]!.x).toBeGreaterThanOrEqual(lastCall![1]!.x);
    }
  });

  it('test 2 — at t=30 s wall clock at 10× speed, scrubber index ≈ row 30', async () => {
    const fixture = makeFixture(60);
    usePositionHistoryMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
    });

    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const qc = makeQc();
    renderScrubber(qc);

    // Select 10× speed.
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '10' } });
    });
    // Press play.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play replay/i }));
    });

    // At 10× speed: each 10 ms wall tick ≡ 100 ms data.
    // 3 000 ticks × 10 ms = 30 s wall → 300 000 ms data → 300 rows at 100 ms/row.
    // But our fixture is 1 Hz (1000 ms/row), so 300 000 ms / 1000 ms/row = 300
    // rows — more than our 60-row fixture. The playback stops at row 59.
    //
    // To land at row ≈ 30 in a 1 Hz fixture we need 30 s of data advance
    // (30 × 1000 ms = 30 000 ms). At 10× that takes 3 000 ms wall clock
    // = 300 ticks of 10 ms.
    const TICKS = 300;
    let wallMs = 1000;
    for (let i = 0; i < TICKS; i++) {
      const cb = rafCallbacks.shift();
      if (!cb) break;
      await act(async () => {
        cb(wallMs);
        wallMs += 10;
      });
    }

    const slider = screen.getByRole('slider');
    const currentIdx = Number((slider as HTMLInputElement).value);
    // Allow ±5 rows tolerance.
    expect(currentIdx).toBeGreaterThanOrEqual(25);
    expect(currentIdx).toBeLessThanOrEqual(35);
  });

  it('test 3 — dots older than the trail window are absent from the sprite list', async () => {
    // 120-row fixture (2 min at 1 Hz) so scrubbing to row 90 puts the
    // trail window at [30 s, 90 s]. Rows 0..29 must not appear.
    const fixture = makeFixture(120);
    usePositionHistoryMock.mockReturnValue({
      data: fixture,
      isLoading: false,
      isError: false,
    });

    const qc = makeQc();
    renderScrubber(qc);

    // Scrub to row 90 via the slider.
    const slider = screen.getByRole('slider');
    await act(async () => {
      fireEvent.change(slider, { target: { value: '90' } });
    });

    // Trail window: [T0 + 30_000, T0 + 90_000].
    const cutoffMs = T0 + 30_000;

    const lastCall = capturedDotCalls.at(-1);
    expect(lastCall).toBeTruthy();
    expect(lastCall!.length).toBeGreaterThan(0);

    for (const dot of lastCall!) {
      // x_canvas = 100 + idx * 2 → idx = (x - 100) / 2
      // recorded_at ms = T0 + idx * 1000
      const dotIdx = (dot.x - 100) / 2;
      const dotMs = T0 + dotIdx * 1000;
      expect(dotMs).toBeGreaterThanOrEqual(cutoffMs);
    }
  });
});
