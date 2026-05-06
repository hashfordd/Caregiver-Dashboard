import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Patient } from '@alzcare/shared';

const { updateMock, eqMock, selectMock, singleMock, fromMock } = vi.hoisted(() => {
  const singleMock = vi.fn();
  const selectMock = vi.fn(() => ({ single: singleMock }));
  const eqMock = vi.fn(() => ({ select: selectMock }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ update: updateMock }));
  return { updateMock, eqMock, selectMock, singleMock, fromMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}));

import { EditPatientDialog } from '@/features/patients/EditPatientDialog';

const PATIENT: Patient = {
  id: '11111111-1111-1111-1111-111111111111',
  full_name: 'Alice Patient',
  dob: '1950-04-12',
  description: 'Likes morning walks',
  primary_caregiver_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

function renderDialog(onOpenChange = vi.fn(), patient: Patient = PATIENT) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <EditPatientDialog open={true} onOpenChange={onOpenChange} patient={patient} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, onOpenChange };
}

beforeEach(() => {
  fromMock.mockClear();
  updateMock.mockClear();
  eqMock.mockClear();
  selectMock.mockClear();
  singleMock.mockReset();
});

describe('EditPatientDialog', () => {
  it('prefills the form with the current patient values', () => {
    renderDialog();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Patient');
    expect(screen.getByLabelText(/date of birth/i)).toHaveValue('1950-04-12');
    expect(screen.getByLabelText(/description/i)).toHaveValue('Likes morning walks');
  });

  it('rejects an empty full_name with a validation error', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updates the patient row scoped by id and invalidates roster + detail caches', async () => {
    singleMock.mockResolvedValue({
      data: { ...PATIENT, full_name: 'Alice Updated' },
      error: null,
    });
    const { qc, onOpenChange } = renderDialog();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(fromMock).toHaveBeenCalledWith('patients');
    expect(updateMock).toHaveBeenCalledWith({
      full_name: 'Alice Updated',
      dob: '1950-04-12',
      description: 'Likes morning walks',
    });
    expect(eqMock).toHaveBeenCalledWith('id', PATIENT.id);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patients', 'roster'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patients', 'detail', PATIENT.id] });
  });

  it('coerces blank optional fields to null on the wire', async () => {
    singleMock.mockResolvedValue({ data: { ...PATIENT }, error: null });
    renderDialog(vi.fn(), { ...PATIENT, dob: null, description: null });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({
      full_name: 'Alice Patient',
      dob: null,
      description: null,
    });
  });

  it('renders the supabase error inline and keeps the dialog open', async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: 'rls denied update' } });
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/rls denied update/i)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
