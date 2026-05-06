import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PatientNote } from '@alzcare/shared';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

const {
  selectListMock,
  eqListMock,
  orderMock,
  insertMock,
  selectInsertMock,
  singleMock,
  fromMock,
} = vi.hoisted(() => {
  const orderMock = vi.fn();
  const eqListMock = vi.fn(() => ({ order: orderMock }));
  const selectListMock = vi.fn(() => ({ eq: eqListMock }));

  const singleMock = vi.fn();
  const selectInsertMock = vi.fn(() => ({ single: singleMock }));
  const insertMock = vi.fn(() => ({ select: selectInsertMock }));

  const fromMock = vi.fn((_table: string) => ({
    select: selectListMock,
    insert: insertMock,
  }));
  return {
    selectListMock,
    eqListMock,
    orderMock,
    insertMock,
    selectInsertMock,
    singleMock,
    fromMock,
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'caregiver-1',
      email: 'caregiver@example.com',
      user_metadata: { full_name: 'Test Caregiver' },
    },
    session: null,
    loading: false,
  }),
}));

import { PatientNotesSection } from '@/features/patients/PatientNotesSection';

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <PatientNotesSection patientId={PATIENT_ID} />
      </QueryClientProvider>,
    ),
  };
}

const NOTE: PatientNote = {
  id: 'note-1',
  patient_id: PATIENT_ID,
  author_caregiver_id: 'caregiver-9',
  author_name: 'Jane Doe',
  body: 'Patient slept well overnight.',
  created_at: '2026-05-01T10:30:00.000Z',
};

beforeEach(() => {
  fromMock.mockClear();
  selectListMock.mockClear();
  eqListMock.mockClear();
  orderMock.mockReset();
  insertMock.mockClear();
  selectInsertMock.mockClear();
  singleMock.mockReset();
});

describe('PatientNotesSection', () => {
  it('renders the existing notes scoped to the patient', async () => {
    orderMock.mockResolvedValue({ data: [NOTE], error: null });
    renderSection();

    expect(await screen.findByText(NOTE.body)).toBeInTheDocument();
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
    expect(fromMock).toHaveBeenCalledWith('patient_notes');
    expect(eqListMock).toHaveBeenCalledWith('patient_id', PATIENT_ID);
  });

  it('shows the empty state when no notes exist', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    renderSection();
    expect(await screen.findByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('rejects an empty body with a validation error and does not insert', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    renderSection();
    await screen.findByText(/no notes yet/i);

    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('inserts a new note with author metadata and refetches on success', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    singleMock.mockResolvedValue({
      data: { ...NOTE, body: 'A fresh note', author_name: 'Test Caregiver' },
      error: null,
    });
    const { qc } = renderSection();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    await screen.findByText(/no notes yet/i);

    fireEvent.change(screen.getByLabelText(/note body/i), {
      target: { value: '  A fresh note  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith({
      patient_id: PATIENT_ID,
      body: 'A fresh note',
      author_caregiver_id: 'caregiver-1',
      author_name: 'Test Caregiver',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patient-notes', PATIENT_ID] });
  });

  it('renders an inline error when the insert fails', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    singleMock.mockResolvedValue({ data: null, error: { message: 'rls denied insert' } });
    renderSection();
    await screen.findByText(/no notes yet/i);

    fireEvent.change(screen.getByLabelText(/note body/i), {
      target: { value: 'Something happened' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));

    expect(await screen.findByText(/rls denied insert/i)).toBeInTheDocument();
  });
});
