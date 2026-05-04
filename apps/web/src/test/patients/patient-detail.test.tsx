import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type SubscribeCb = (status: string, err?: Error) => void;
type OnCb = (payload: { new: unknown }) => void;

const { channels, channelMock, removeChannelMock, maybeSingleMock } = vi.hoisted(() => {
  const channels = new Map<string, { subscribeCb: SubscribeCb | null; ons: Map<string, OnCb> }>();
  const channelMock = vi.fn((name: string) => {
    const state = { subscribeCb: null as SubscribeCb | null, ons: new Map<string, OnCb>() };
    channels.set(name, state);
    const channel: {
      on: (event: string, opts: { table: string }, cb: OnCb) => typeof channel;
      subscribe: (cb: SubscribeCb) => typeof channel;
    } = {
      on: vi.fn((_event, opts, cb) => {
        state.ons.set(opts.table, cb);
        return channel;
      }),
      subscribe: vi.fn((cb) => {
        state.subscribeCb = cb;
        return channel;
      }),
    };
    return channel;
  });
  return {
    channels,
    channelMock,
    removeChannelMock: vi.fn(),
    maybeSingleMock: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: channelMock,
    removeChannel: removeChannelMock,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
      })),
    })),
  },
}));

import { PatientDetailPage } from '@/features/patients/PatientDetailPage';

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  channels.clear();
  channelMock.mockClear();
  removeChannelMock.mockClear();
  maybeSingleMock.mockReset();
});

describe('PatientDetailPage', () => {
  it('renders the patient name once the query resolves', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: PATIENT_ID,
        full_name: 'Alice Patient',
        dob: null,
        notes: null,
        primary_caregiver_id: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    renderAt(`/patients/${PATIENT_ID}`);
    expect(await screen.findByRole('heading', { name: 'Alice Patient' })).toBeInTheDocument();
  });

  it('renders the not-found state when the patient is missing or RLS-denied', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    renderAt(`/patients/${PATIENT_ID}`);
    expect(await screen.findByText(/patient not found/i)).toBeInTheDocument();
    expect(screen.getByText(/back to roster/i)).toBeInTheDocument();
  });

  it('does not re-subscribe to the realtime channel when switching tabs', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: PATIENT_ID,
        full_name: 'Alice Patient',
        dob: null,
        notes: null,
        primary_caregiver_id: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    renderAt(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'Alice Patient' });

    fireEvent.click(screen.getByRole('tab', { name: /place/i }));
    fireEvent.click(screen.getByRole('tab', { name: /history/i }));
    fireEvent.click(screen.getByRole('tab', { name: /alerts/i }));
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));
    fireEvent.click(screen.getByRole('tab', { name: /live/i }));

    await waitFor(() => {
      expect(channelMock).toHaveBeenCalledTimes(1);
    });
    expect(channelMock).toHaveBeenCalledWith(`patient:${PATIENT_ID}`);
    expect(removeChannelMock).not.toHaveBeenCalled();
  });
});
