import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomConnectorDialog } from '@/features/floor-plan/RoomConnectorDialog';
import type { RoomRow } from '@/features/floor-plan/roomTypes';

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

describe('RoomConnectorDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onOpenChange = vi.fn();
  });

  it('defaults to the presetKind when adding', () => {
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={[]}
        presetKind="window"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByLabelText(/kind/i)).toHaveValue('window');
  });

  it('disables submit until all 4 coords are finite numbers and endpoints are distinct', () => {
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={[]}
        presetKind="door"
        onConfirm={onConfirm}
      />,
    );
    const submit = screen.getByRole('button', { name: /add connector/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/start x/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/start y/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/end x/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/end y/i), { target: { value: '20' } });
    // Coincident endpoints — still disabled.
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/end x/i), { target: { value: '40' } });
    expect(submit).not.toBeDisabled();
  });

  it('forwards parsed coords + selected room ids to onConfirm', async () => {
    const rooms = [room({ id: 'r-bed', name: 'Bedroom' }), room({ id: 'r-hall', name: 'Hallway' })];
    render(
      <RoomConnectorDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        rooms={rooms}
        presetKind="door"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText(/start x/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/start y/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/end x/i), { target: { value: '180' } });
    fireEvent.change(screen.getByLabelText(/end y/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/room a/i), { target: { value: 'r-bed' } });
    fireEvent.change(screen.getByLabelText(/room b/i), { target: { value: 'r-hall' } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'Bedroom door' } });

    // Segment length shown as 80 px (the door is 80 px wide).
    expect(screen.getByText(/segment length: 80 px/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add connector/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: PATIENT_ID,
        floor_plan_id: FLOOR_PLAN_ID,
        kind: 'door',
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
