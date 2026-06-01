import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomConnectorDialog } from '@/features/floor-plan/RoomConnectorDialog';
import type { RoomConnectorRow, RoomRow } from '@/features/floor-plan/roomTypes';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const FLOOR_PLAN_ID = '22222222-2222-2222-2222-222222222222';

function room(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: 'r-1',
    patient_id: PATIENT_ID,
    floor_plan_id: FLOOR_PLAN_ID,
    name: 'Room 1',
    room_type: 'other',
    polygon_canvas: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    created_at: '2026-05-29T00:00:00Z',
    updated_at: '2026-05-29T00:00:00Z',
    ...overrides,
  };
}

function connector(overrides: Partial<RoomConnectorRow> = {}): RoomConnectorRow {
  return {
    id: 'c-1',
    patient_id: PATIENT_ID,
    floor_plan_id: FLOOR_PLAN_ID,
    kind: 'door',
    start_x: 100,
    start_y: 200,
    end_x: 180,
    end_y: 200,
    room_a_id: null,
    room_b_id: null,
    label: null,
    created_at: '2026-05-29T00:00:00Z',
    updated_at: '2026-05-29T00:00:00Z',
    ...overrides,
  };
}

describe('RoomConnectorDialog (metadata-only)', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onOpenChange = vi.fn();
  });

  it('seeds fields from the connector being edited', () => {
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={[]}
        initial={connector({ kind: 'window', label: 'Bay window' })}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByLabelText(/kind/i)).toHaveValue('window');
    expect(screen.getByLabelText(/label/i)).toHaveValue('Bay window');
  });

  it('does not render endpoint coordinate inputs', () => {
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={[]}
        initial={connector()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByLabelText(/start x/i)).toBeNull();
    expect(screen.queryByLabelText(/end y/i)).toBeNull();
  });

  it('preserves geometry while forwarding edited metadata to onConfirm', async () => {
    const rooms = [room({ id: 'r-bed', name: 'Bedroom' }), room({ id: 'r-hall', name: 'Hallway' })];
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={rooms}
        initial={connector()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText(/room a/i), { target: { value: 'r-bed' } });
    fireEvent.change(screen.getByLabelText(/room b/i), { target: { value: 'r-hall' } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Bedroom door' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c-1',
        patient_id: PATIENT_ID,
        floor_plan_id: FLOOR_PLAN_ID,
        kind: 'door',
        // Geometry passes through untouched — repositioning is drag-on-canvas.
        start_x: 100,
        start_y: 200,
        end_x: 180,
        end_y: 200,
        room_a_id: 'r-bed',
        room_b_id: 'r-hall',
        label: 'Bedroom door',
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
