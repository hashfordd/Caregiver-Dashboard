import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

const profileRow = {
  id: 'user-1',
  email: 'jane@example.com',
  full_name: 'Jane Doe',
  role: 'family' as const,
  company_name: null as string | null,
};

const singleMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: singleMock })),
      })),
      update: updateMock,
    })),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, session: {}, loading: false }),
  AuthProvider: ({ children }: { children: ReactElement }) => children,
}));

import { ProfilePage } from '@/features/auth/ProfilePage';

function renderProfilePage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    singleMock.mockReset();
    updateMock.mockReset();
    updateEqMock.mockReset();
    updateMock.mockReturnValue({ eq: updateEqMock });
  });

  it('renders the loading state while the query is in flight', () => {
    singleMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderProfilePage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the caregiver profile once loaded', async () => {
    singleMock.mockResolvedValue({
      data: { ...profileRow, company_name: 'St. Vincent’s' },
      error: null,
    });
    renderProfilePage();

    expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeDisabled();
    expect(screen.getByDisplayValue(/Vincent/)).toBeInTheDocument();
    const roleSelect = screen.getByLabelText(/role/i) as HTMLSelectElement;
    expect(roleSelect.value).toBe('family');
  });

  it('submits full_name, role and company_name on save (email is read-only)', async () => {
    singleMock.mockResolvedValue({ data: profileRow, error: null });
    updateEqMock.mockResolvedValue({ error: null });

    renderProfilePage();

    const fullNameInput = await screen.findByDisplayValue('Jane Doe');
    fireEvent.change(fullNameInput, { target: { value: 'Jane Q. Doe' } });
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'professional' } });
    fireEvent.change(screen.getByLabelText(/company/i), {
      target: { value: 'Riverside Care' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({
      full_name: 'Jane Q. Doe',
      role: 'professional',
      company_name: 'Riverside Care',
    });
    expect(updateEqMock).toHaveBeenCalledWith('id', 'user-1');
  });

  it('persists null when company is left blank', async () => {
    singleMock.mockResolvedValue({ data: profileRow, error: null });
    updateEqMock.mockResolvedValue({ error: null });

    renderProfilePage();

    await screen.findByDisplayValue('Jane Doe');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ company_name: null }));
  });
});
