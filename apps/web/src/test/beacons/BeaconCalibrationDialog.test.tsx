import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SignalsMessage } from '@alzcare/shared/mqtt';
import type { PatientStreamContextValue } from '@/features/patients/PatientStreamContext';
import type { BeaconRow } from '@/features/beacons/types';

const PATIENT = '11111111-1111-1111-1111-111111111111';

const { useUpdateMock, mutateAsyncMock, patientStreamContextValue, registeredListeners } =
  vi.hoisted(() => {
    const registeredListeners = new Set<(msg: SignalsMessage) => void>();
    return {
      useUpdateMock: vi.fn(),
      mutateAsyncMock: vi.fn(),
      patientStreamContextValue: { current: null as null | PatientStreamContextValue },
      registeredListeners,
    };
  });

vi.mock('@/features/beacons/beaconQueries', () => ({
  useUpdateBeaconCalibration: (...args: unknown[]) => useUpdateMock(...args),
}));

vi.mock('@/features/patients/PatientStreamContext', () => ({
  usePatientStreamContext: () => patientStreamContextValue.current,
  PatientStreamProvider: ({ children }: { children: ReactNode }) => children,
}));

import { BeaconCalibrationDialog } from '@/features/beacons/BeaconCalibrationDialog';

function setStreamStatus(status: PatientStreamContextValue['status']) {
  patientStreamContextValue.current = {
    patientId: PATIENT,
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

function bleMessage(samples: { mac: string; rssi: number }[]): SignalsMessage {
  return {
    v: 1,
    patient_id: PATIENT,
    device_id: 'd1',
    recorded_at: new Date().toISOString(),
    ble: samples,
    wifi: [],
  };
}

function pushAll(msg: SignalsMessage) {
  for (const cb of registeredListeners) cb(msg);
}

const BEACON: BeaconRow = {
  id: 'b-1',
  patient_id: PATIENT,
  floor_plan_id: 'fp-1',
  mac_address: 'AA:BB:CC:DD:EE:FF',
  label: 'Living room',
  x_canvas: 100,
  y_canvas: 200,
  tx_power: null,
  rssi_at_1m: null,
  created_at: '2026-05-06T00:00:00Z',
};

function renderDialog(beacon: BeaconRow | null = BEACON) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BeaconCalibrationDialog
        beacon={beacon}
        patientId={PATIENT}
        open={beacon != null}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  registeredListeners.clear();
  mutateAsyncMock.mockReset();
  useUpdateMock.mockReturnValue({ mutateAsync: mutateAsyncMock });
  setStreamStatus('subscribed');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BeaconCalibrationDialog', () => {
  it('renders nothing when no beacon is selected', () => {
    const { container } = renderDialog(null);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the calibration prompt with current state', async () => {
    renderDialog();
    expect(screen.getByText(/calibrate beacon/i)).toBeTruthy();
    expect(screen.getByText(/not set/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start 5 s capture/i })).toBeTruthy();
  });

  it('captures 5 seconds of RSSI samples and surfaces the mean', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /start 5 s capture/i }));

    // Push known samples; mean should be -65 dBm.
    await act(async () => {
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -60 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -70 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
      // Push an unrelated MAC; should be ignored.
      pushAll(bleMessage([{ mac: 'OTHER', rssi: -10 }]));
    });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText(/captured/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save calibration/i })).toBeTruthy();
    // Mean of (-60, -65, -70, -65, -65) = -65; dialog should mention it.
    expect(screen.getAllByText(/-65/).length).toBeGreaterThan(0);
  });

  it('writes rssi_at_1m and tx_power to the same rounded mean on save', async () => {
    mutateAsyncMock.mockResolvedValue({ ...BEACON, rssi_at_1m: -65, tx_power: -65 });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /start 5 s capture/i }));

    await act(async () => {
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -64 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -66 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
      pushAll(bleMessage([{ mac: BEACON.mac_address, rssi: -65 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save calibration/i }));
    });

    expect(mutateAsyncMock).toHaveBeenCalledWith({
      id: 'b-1',
      rssi_at_1m: -65,
      tx_power: -65,
    });
  });

  it('fails with a clear reason when no samples arrive in the window', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /start 5 s capture/i }));
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(/calibration failed/i)).toBeTruthy();
    expect(screen.getByText(/insufficient_samples|too few rssi/i)).toBeTruthy();
  });

  it('disables Start when the realtime stream is disconnected', () => {
    setStreamStatus('disconnected');
    renderDialog();
    const btn = screen.getByRole('button', { name: /start 5 s capture/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
