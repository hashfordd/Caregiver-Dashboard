import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { orderMock } = vi.hoisted(() => ({ orderMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ order: orderMock })),
    })),
    rpc: vi.fn(),
  },
}));

import { RosterPage } from '@/features/patients/RosterPage';

function renderRoster() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RosterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RosterPage', () => {
  beforeEach(() => {
    orderMock.mockReset();
  });

  it('renders skeleton placeholders while the query is loading', () => {
    orderMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderRoster();
    const loadingContainer = container.querySelector('[data-testid="roster-loading"]');
    expect(loadingContainer).not.toBeNull();
    expect(loadingContainer!.children).toHaveLength(3);
  });

  it('renders the empty state with a Create CTA when there are no patients', async () => {
    orderMock.mockResolvedValue({ data: [], error: null });
    renderRoster();

    expect(await screen.findByText(/no patients allocated/i)).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /create your first patient/i });
    fireEvent.click(cta);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new patient/i })).toBeInTheDocument();
  });

  it('renders patient cards as links to /patients/:id when the roster is non-empty', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          full_name: 'Alice Patient',
          dob: null,
          notes: null,
          primary_caregiver_id: null,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          full_name: 'Bob Patient',
          dob: '1950-01-01',
          notes: 'A note',
          primary_caregiver_id: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
    });

    renderRoster();

    expect(await screen.findByText('Alice Patient')).toBeInTheDocument();
    expect(screen.getByText('Bob Patient')).toBeInTheDocument();
    const aliceLink = screen.getByText('Alice Patient').closest('a');
    expect(aliceLink).toHaveAttribute('href', '/patients/11111111-1111-1111-1111-111111111111');
  });

  it('renders an error state with a retry button when the query fails', async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: 'database is sleeping' } });
    renderRoster();

    expect(await screen.findByText(/couldn't load the roster/i)).toBeInTheDocument();
    expect(screen.getByText(/database is sleeping/i)).toBeInTheDocument();

    orderMock.mockResolvedValueOnce({ data: [], error: null });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(orderMock).toHaveBeenCalledTimes(2));
  });
});
