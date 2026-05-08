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
  insertSingleMock,
  updateMock,
  eqUpdateMock,
  selectUpdateMock,
  updateSingleMock,
  deleteMock,
  eqDeleteMock,
  fromMock,
} = vi.hoisted(() => {
  const orderMock = vi.fn();
  const eqListMock = vi.fn(() => ({ order: orderMock }));
  const selectListMock = vi.fn(() => ({ eq: eqListMock }));

  const insertSingleMock = vi.fn();
  const selectInsertMock = vi.fn(() => ({ single: insertSingleMock }));
  const insertMock = vi.fn(() => ({ select: selectInsertMock }));

  const updateSingleMock = vi.fn();
  const selectUpdateMock = vi.fn(() => ({ single: updateSingleMock }));
  const eqUpdateMock = vi.fn(() => ({ select: selectUpdateMock }));
  const updateMock = vi.fn(() => ({ eq: eqUpdateMock }));

  const eqDeleteMock = vi.fn();
  const deleteMock = vi.fn(() => ({ eq: eqDeleteMock }));

  const fromMock = vi.fn(() => ({
    select: selectListMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  }));
  return {
    selectListMock,
    eqListMock,
    orderMock,
    insertMock,
    selectInsertMock,
    insertSingleMock,
    updateMock,
    eqUpdateMock,
    selectUpdateMock,
    updateSingleMock,
    deleteMock,
    eqDeleteMock,
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

const PEER_NOTE: PatientNote = {
  id: 'note-1',
  patient_id: PATIENT_ID,
  author_caregiver_id: 'caregiver-9',
  body: 'Patient slept well overnight.',
  created_at: '2026-05-01T10:30:00.000Z',
  author: { full_name: 'Jane Doe' },
};

const OWN_NOTE: PatientNote = {
  id: 'note-own',
  patient_id: PATIENT_ID,
  author_caregiver_id: 'caregiver-1',
  body: 'My own note.',
  created_at: '2026-05-02T08:00:00.000Z',
  author: { full_name: 'Test Caregiver' },
};

beforeEach(() => {
  fromMock.mockClear();
  selectListMock.mockClear();
  eqListMock.mockClear();
  orderMock.mockReset();
  insertMock.mockClear();
  selectInsertMock.mockClear();
  insertSingleMock.mockReset();
  updateMock.mockClear();
  eqUpdateMock.mockClear();
  selectUpdateMock.mockClear();
  updateSingleMock.mockReset();
  deleteMock.mockClear();
  eqDeleteMock.mockReset();
});

describe('PatientNotesSection', () => {
  it('renders the existing notes scoped to the patient (author resolved via embed)', async () => {
    orderMock.mockResolvedValue({ data: [PEER_NOTE], error: null });
    renderSection();

    expect(await screen.findByText(PEER_NOTE.body)).toBeInTheDocument();
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

  it('inserts a new note WITHOUT author_name (resolved server-side via embed) and refetches on success', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    insertSingleMock.mockResolvedValue({
      data: { ...OWN_NOTE, body: 'A fresh note' },
      error: null,
    });
    const { qc } = renderSection();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    await screen.findByText(/no notes yet/i);

    fireEvent.change(screen.getByLabelText(/^note body$/i), {
      target: { value: '  A fresh note  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));

    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect(insertMock).toHaveBeenCalledWith({
      patient_id: PATIENT_ID,
      body: 'A fresh note',
      author_caregiver_id: 'caregiver-1',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patient-notes', PATIENT_ID] });
  });

  it('renders an inline error when the insert fails', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    insertSingleMock.mockResolvedValue({ data: null, error: { message: 'rls denied insert' } });
    renderSection();
    await screen.findByText(/no notes yet/i);

    fireEvent.change(screen.getByLabelText(/^note body$/i), {
      target: { value: 'Something happened' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));

    expect(await screen.findByText(/rls denied insert/i)).toBeInTheDocument();
  });

  it("shows edit and delete affordances on the user's own notes only", async () => {
    orderMock.mockResolvedValue({ data: [PEER_NOTE, OWN_NOTE], error: null });
    renderSection();
    await screen.findByText(OWN_NOTE.body);

    // Own note exposes edit + delete buttons; peer note does not.
    expect(screen.getAllByRole('button', { name: /edit note/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /delete note/i })).toHaveLength(1);
  });

  it('updates an own note via the edit form and invalidates the cache', async () => {
    orderMock.mockResolvedValue({ data: [OWN_NOTE], error: null });
    updateSingleMock.mockResolvedValue({
      data: { ...OWN_NOTE, body: 'Edited body' },
      error: null,
    });
    const { qc } = renderSection();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    await screen.findByText(OWN_NOTE.body);

    fireEvent.click(screen.getByRole('button', { name: /edit note/i }));
    fireEvent.change(screen.getByLabelText(/edit note body/i), {
      target: { value: 'Edited body' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({ body: 'Edited body' });
    expect(eqUpdateMock).toHaveBeenCalledWith('id', OWN_NOTE.id);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['patient-notes', PATIENT_ID] });
  });

  it('deletes an own note after a confirm step (optimistic remove)', async () => {
    orderMock.mockResolvedValue({ data: [OWN_NOTE], error: null });
    eqDeleteMock.mockResolvedValue({ data: null, error: null });
    renderSection();
    await screen.findByText(OWN_NOTE.body);

    fireEvent.click(screen.getByRole('button', { name: /delete note/i }));
    // Now the row exposes a Confirm button instead.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(eqDeleteMock).toHaveBeenCalledWith('id', OWN_NOTE.id);
  });
});
