import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import type { PatientStreamContextValue } from '@/features/patients/PatientStreamContext';

const { useCaptureMock, captureMutateAsyncMock, patientStreamContextValue, registeredListeners } =
  vi.hoisted(() => {
    const registeredListeners: Set<(msg: SignalsMessage) => void> = new Set();
    return {
      useCaptureMock: vi.fn(),
      captureMutateAsyncMock: vi.fn(),
      patientStreamContextValue: {
        current: null as null | PatientStreamContextValue,
      },
      registeredListeners,
    };
  });

vi.mock('@/features/calibration/calibrationQueries', () => ({
  useCaptureCalibrationPoint: (...args: unknown[]) => useCaptureMock(...args),
  useCalibrationPoints: vi.fn(),
  useDeleteCalibrationPoint: vi.fn(),
}));

// Replace the patient-stream context with a configurable hook.
vi.mock('@/features/patients/PatientStreamContext', () => ({
  usePatientStreamContext: () => patientStreamContextValue.current,
  PatientStreamProvider: ({ children }: { children: ReactNode }) => children,
}));

import { CaptureCoordinator } from '@/features/calibration/CaptureCoordinator';

const FLOOR_PLAN_ID = '22222222-2222-2222-2222-222222222222';

function bleMessage(samples: { mac: string; rssi: number }[]): SignalsMessage {
  return {
    v: 1,
    patient_id: '11111111-1111-1111-1111-111111111111',
    device_id: 'd1',
    recorded_at: new Date().toISOString(),
    ble: samples,
    wifi: [],
  };
}

function withPatientStreamStatus(status: PatientStreamContextValue['status']) {
  patientStreamContextValue.current = {
    patientId: '11111111-1111-1111-1111-111111111111',
    status,
    lastSeen: { sensor: null, position: null, alert: null, signals: null },
    onSensorReading: () => () => {},
    onPositionEstimate: () => () => {},
    onAlert: () => () => {},
    onSignals: (cb) => {
      registeredListeners.add(cb);
      return () => {
        registeredListeners.delete(cb);
      };
    },
  };
}

function pushAll(msg: SignalsMessage) {
  for (const cb of registeredListeners) cb(msg);
}

interface RenderOptions {
  pending?: { x: number; y: number } | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

function renderCoordinator(opts: RenderOptions = {}) {
  const onSuccess = opts.onSuccess ?? vi.fn();
  const onCancel = opts.onCancel ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CaptureCoordinator
        floorPlanId={FLOOR_PLAN_ID}
        pending={opts.pending ?? { x: 100, y: 200 }}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSuccess, onCancel };
}

beforeEach(() => {
  vi.useFakeTimers();
  registeredListeners.clear();
  withPatientStreamStatus('subscribed');
  useCaptureMock.mockReturnValue({
    mutateAsync: captureMutateAsyncMock,
    isPending: false,
    isError: false,
    error: null,
  });
  captureMutateAsyncMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CaptureCoordinator', () => {
  it('happy path: 60 samples in 5 s → row written with the aggregated signature', async () => {
    captureMutateAsyncMock.mockResolvedValue({});
    const { onSuccess } = renderCoordinator();

    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    expect(registeredListeners.size).toBe(1);

    // Push 60 BLE samples spread across 5 s for three MACs.
    for (let i = 0; i < 60; i++) {
      act(() => {
        pushAll(
          bleMessage([
            { mac: 'aa:bb:cc:dd:ee:01', rssi: -55 + Math.sin(i / 5) },
            { mac: 'aa:bb:cc:dd:ee:02', rssi: -65 + Math.cos(i / 5) },
            { mac: 'aa:bb:cc:dd:ee:03', rssi: -70 },
          ]),
        );
      });
      act(() => {
        vi.advanceTimersByTime(80);
      });
    }
    // Push the 5 s deadline.
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(captureMutateAsyncMock).toHaveBeenCalledTimes(1);
    const arg = captureMutateAsyncMock.mock.calls[0]![0] as {
      ble_signature: { samples: unknown[]; quality: { sample_count_total: number } };
      x_canvas: number;
      y_canvas: number;
    };
    expect(arg.x_canvas).toBe(100);
    expect(arg.y_canvas).toBe(200);
    expect(arg.ble_signature.samples.length).toBe(3);
    expect(arg.ble_signature.quality.sample_count_total).toBeGreaterThanOrEqual(30);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    // Listener torn down after success.
    expect(registeredListeners.size).toBe(0);
  });

  it('extends to 10 s when below 30 samples at the 5 s mark, then succeeds with enough samples', async () => {
    captureMutateAsyncMock.mockResolvedValue({});
    renderCoordinator();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));

    // 12 samples spread over 5 s — below the 30-sample floor.
    for (let i = 0; i < 12; i++) {
      act(() => pushAll(bleMessage([{ mac: 'm', rssi: -55 }])));
      act(() => vi.advanceTimersByTime(400));
    }
    // Cross the 5 s threshold — should extend, not finalise.
    act(() => vi.advanceTimersByTime(300));
    expect(captureMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Extending/i)).toBeTruthy();

    // Top up samples in the extension window.
    for (let i = 0; i < 24; i++) {
      act(() => pushAll(bleMessage([{ mac: 'm', rssi: -55 }])));
      act(() => vi.advanceTimersByTime(150));
    }
    await act(async () => {
      vi.advanceTimersByTime(EXT_REMAINING_MS);
      await Promise.resolve();
    });
    expect(captureMutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with sample_count_below_threshold when extension window also fails the floor', async () => {
    renderCoordinator();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));

    // 12 samples total, sparse.
    for (let i = 0; i < 12; i++) {
      act(() => pushAll(bleMessage([{ mac: 'm', rssi: -55 }])));
      act(() => vi.advanceTimersByTime(400));
    }
    act(() => vi.advanceTimersByTime(300));
    // Now in the extension window with no further samples.
    await act(async () => {
      vi.advanceTimersByTime(EXT_REMAINING_MS);
      await Promise.resolve();
    });
    expect(captureMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Signal too sparse/i)).toBeTruthy();
  });

  it('rejects with no_signals when no samples arrive in the initial window', async () => {
    renderCoordinator();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    await act(async () => {
      vi.advanceTimersByTime(5_500);
      await Promise.resolve();
    });
    expect(captureMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.getByText(/No signals received/i)).toBeTruthy();
  });

  it('rejects with unstable_signal when 60 samples have high stddev', async () => {
    renderCoordinator();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    // 60 BLE samples with very high jitter on the strongest MAC.
    for (let i = 0; i < 60; i++) {
      const r = -50 - 30 * Math.sin(i); // ±30 swing
      act(() => pushAll(bleMessage([{ mac: 'noisy', rssi: r }])));
      act(() => vi.advanceTimersByTime(80));
    }
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(captureMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Signal too unstable/i)).toBeTruthy();
  });

  it('refuses to capture when the realtime stream is disconnected', () => {
    withPatientStreamStatus('disconnected');
    renderCoordinator();
    // Capture button is disabled when stream isn't subscribed.
    const capture = screen.getByRole('button', { name: /^capture$/i });
    expect((capture as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/stream:/i)).toBeTruthy();
  });

  it('cleans up listener and timers on unmount before the window closes', () => {
    const { unmount } = renderCoordinator();
    fireEvent.click(screen.getByRole('button', { name: /^capture$/i }));
    expect(registeredListeners.size).toBe(1);
    act(() => vi.advanceTimersByTime(2_000));
    unmount();
    expect(registeredListeners.size).toBe(0);
    // Pushing post-unmount must not throw or invoke the mutation.
    act(() => vi.advanceTimersByTime(10_000));
    expect(captureMutateAsyncMock).not.toHaveBeenCalled();
  });
});

const EXT_REMAINING_MS = 5_500; // (10s extended - 5s already advanced) + buffer
