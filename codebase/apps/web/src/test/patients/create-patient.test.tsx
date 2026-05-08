import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { CreatePatientDialog } from '@/features/patients/CreatePatientDialog';

function renderDialog(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CreatePatientDialog open={true} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, onOpenChange };
}

describe('CreatePatientDialog', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('rejects an empty full_name with a validation error', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /create patient/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('submits via rpc with the right parameter names and closes on success', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 'p-1', full_name: 'Charlie', dob: null, description: null },
      error: null,
    });
    const { qc, onOpenChange } = renderDialog();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Charlie' } });
    fireEvent.click(screen.getByRole('button', { name: /create patient/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith('create_patient_with_allocation', {
      p_full_name: 'Charlie',
      p_dob: null,
      p_description: null,
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patients', 'roster'] });
  });

  it('renders the rpc error inline and keeps the dialog open', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc exploded' } });
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Drew' } });
    fireEvent.click(screen.getByRole('button', { name: /create patient/i }));

    expect(await screen.findByText(/rpc exploded/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
