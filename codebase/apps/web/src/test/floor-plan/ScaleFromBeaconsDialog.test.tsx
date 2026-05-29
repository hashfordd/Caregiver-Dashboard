import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScaleFromBeaconsDialog } from '@/features/floor-plan/ScaleFromBeaconsDialog';
import type { BeaconRow } from '@/features/beacons/types';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

function beacon(overrides: Partial<BeaconRow> = {}): BeaconRow {
  return {
    id: 'b-1',
    patient_id: PATIENT_ID,
    floor_plan_id: null,
    mac_address: 'AA:01',
    label: 'Living room',
    x_canvas: 0,
    y_canvas: 0,
    tx_power: null,
    rssi_at_1m: null,
    created_at: '2026-05-04T00:00:00Z',
    ...overrides,
  };
}

describe('ScaleFromBeaconsDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn();
    onOpenChange = vi.fn();
  });

  it('renders the "place two beacons first" notice when fewer than 2 are placed', () => {
    render(
      <ScaleFromBeaconsDialog
        open
        onOpenChange={onOpenChange}
        beacons={[beacon({ x_canvas: null, y_canvas: null })]}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/place two beacons first/i)).toBeInTheDocument();
  });

  it('shows the pixel distance between the two default-selected beacons', () => {
    render(
      <ScaleFromBeaconsDialog
        open
        onOpenChange={onOpenChange}
        beacons={[
          beacon({ id: 'b-1', x_canvas: 0, y_canvas: 0, label: 'A' }),
          beacon({ id: 'b-2', x_canvas: 100, y_canvas: 0, label: 'B' }),
        ]}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText(/100 px/i)).toBeInTheDocument();
  });

  it('previews and confirms the back-solved scale: 100 px / 5 m → 0.05 m/px', () => {
    render(
      <ScaleFromBeaconsDialog
        open
        onOpenChange={onOpenChange}
        beacons={[
          beacon({ id: 'b-1', x_canvas: 0, y_canvas: 0, label: 'A' }),
          beacon({ id: 'b-2', x_canvas: 100, y_canvas: 0, label: 'B' }),
        ]}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText(/measured distance in metres/i), {
      target: { value: '5' },
    });
    // Live preview before submission.
    expect(screen.getByText(/1 px = 0\.0500 m/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^set scale$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0]).toBeCloseTo(0.05, 6);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('rejects coincident beacons with an actionable error and does not confirm', () => {
    render(
      <ScaleFromBeaconsDialog
        open
        onOpenChange={onOpenChange}
        beacons={[
          beacon({ id: 'b-1', x_canvas: 50, y_canvas: 50, label: 'A' }),
          beacon({ id: 'b-2', x_canvas: 50, y_canvas: 50, label: 'B' }),
        ]}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText(/measured distance in metres/i), {
      target: { value: '5' },
    });
    // Submit button is disabled (distinct check fails on coincidence too if
    // ids differ but coords match — error shows on submit attempt).
    const submit = screen.getByRole('button', { name: /^set scale$/i });
    fireEvent.click(submit);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/the two beacons share the same canvas position/i)).toBeInTheDocument();
  });

  it('keeps the submit button disabled while the metres input is empty or non-positive', () => {
    render(
      <ScaleFromBeaconsDialog
        open
        onOpenChange={onOpenChange}
        beacons={[
          beacon({ id: 'b-1', x_canvas: 0, y_canvas: 0, label: 'A' }),
          beacon({ id: 'b-2', x_canvas: 10, y_canvas: 0, label: 'B' }),
        ]}
        onConfirm={onConfirm}
      />,
    );
    const submit = screen.getByRole('button', { name: /^set scale$/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/measured distance in metres/i), {
      target: { value: '0' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/measured distance in metres/i), {
      target: { value: '1.5' },
    });
    expect(submit).not.toBeDisabled();
  });
});
