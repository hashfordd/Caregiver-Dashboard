import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomDialog } from '@/features/floor-plan/RoomDialog';
import type { RoomRow } from '@/features/floor-plan/roomTypes';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const FLOOR_PLAN_ID = '22222222-2222-2222-2222-222222222222';

describe('RoomDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onOpenChange = vi.fn();
  });

  it('renders the Add title and disables submit until name + polygon are valid', () => {
    render(
      <RoomDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('heading', { name: /add room/i })).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /^add room$/i });
    expect(submit).toBeDisabled();
  });

  it('parses a 4-vertex polygon and forwards it to onConfirm with the input shape', async () => {
    render(
      <RoomDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Master bedroom' } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'bedroom' } });
    fireEvent.change(screen.getByLabelText(/polygon vertices/i), {
      target: { value: '100, 100\n400, 100\n400, 300\n100, 300' },
    });
    // Sanity: preview shows the vertex count.
    expect(screen.getByText(/4 vertices/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^add room$/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        patient_id: PATIENT_ID,
        floor_plan_id: FLOOR_PLAN_ID,
        name: 'Master bedroom',
        room_type: 'bedroom',
        polygon_canvas: [
          [100, 100],
          [400, 100],
          [400, 300],
          [100, 300],
        ],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces the parse error on a malformed polygon and prevents submission', async () => {
    render(
      <RoomDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bad room' } });
    fireEvent.change(screen.getByLabelText(/polygon vertices/i), {
      target: { value: '0, 0\n10, 10' },
    });
    expect(screen.getByText(/at least 3 vertices/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^add room$/i })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('hydrates from `initial` for edits, including the existing polygon text', () => {
    const initial: RoomRow = {
      id: 'r-1',
      patient_id: PATIENT_ID,
      floor_plan_id: FLOOR_PLAN_ID,
      name: 'Kitchen',
      room_type: 'kitchen',
      polygon_canvas: [
        [50, 50],
        [150, 50],
        [150, 150],
        [50, 150],
      ],
      created_at: '2026-05-29T00:00:00Z',
      updated_at: '2026-05-29T00:00:00Z',
    };
    render(
      <RoomDialog
        open
        onOpenChange={onOpenChange}
        patientId={PATIENT_ID}
        floorPlanId={FLOOR_PLAN_ID}
        initial={initial}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('heading', { name: /edit room/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toHaveValue('Kitchen');
    expect(screen.getByLabelText(/polygon vertices/i)).toHaveValue(
      '50, 50\n150, 50\n150, 150\n50, 150',
    );
  });
});
