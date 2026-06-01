import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScaleDialog } from '@/features/floor-plan/ScaleDialog';
import { WallLengthDialog } from '@/features/floor-plan/WallLengthDialog';

describe('ScaleDialog logic', () => {
  it('confirms the computed scale and closes on submit', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ScaleDialog open pixelLength={100} onConfirm={onConfirm} onOpenChange={onOpenChange} />,
    );
    fireEvent.change(screen.getByLabelText(/length in metres/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /set scale/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // 5 m over 100 px = 0.05 m/px
    expect(onConfirm).toHaveBeenCalledWith(expect.closeTo(0.05, 6));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('WallLengthDialog logic', () => {
  it('confirms the new length and closes on submit', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <WallLengthDialog
        open
        pixelLength={200}
        scaleMetersPerPixel={0.02}
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    );
    const input = screen.getByLabelText(/new length/i);
    fireEvent.change(input, { target: { value: '3.5' } });
    // The typed value must survive (not get reset by an effect).
    expect((input as HTMLInputElement).value).toBe('3.5');
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(3.5));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
