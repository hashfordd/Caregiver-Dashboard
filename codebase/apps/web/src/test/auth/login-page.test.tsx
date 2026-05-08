import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { signInMock, signInOtpMock, navigateMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  signInOtpMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: signInMock,
      signInWithOtp: signInOtpMock,
    },
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { LoginPage } from '@/features/auth/LoginPage';

function renderLogin(initialEntry = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route path="/patients/:id" element={<div>Patient detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signInMock.mockReset();
  signInOtpMock.mockReset();
  navigateMock.mockReset();
});

describe('LoginPage', () => {
  it('renders the password sign-in form by default', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('navigates to / on successful sign-in when no state.from is set', async () => {
    signInMock.mockResolvedValue({ error: null });
    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw12345' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(signInMock).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw12345' });
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  it('renders the inline error when signInWithPassword returns an error', async () => {
    signInMock.mockResolvedValue({ error: { message: 'invalid credentials' } });
    renderLogin();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('Phase A item 7: navigates to state.from after sign-in so deep links survive auth redirect', async () => {
    signInMock.mockResolvedValue({ error: null });
    // ProtectedRoute redirects with `state={{ from: location }}` — simulate by
    // pushing into the history with the same shape.
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login',
            state: { from: { pathname: '/patients/abc?tab=alerts' } },
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw12345' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(navigateMock).toHaveBeenCalledWith('/patients/abc?tab=alerts', { replace: true });
  });

  it('switches to magic-link mode and sends an OTP to the entered email', async () => {
    signInOtpMock.mockResolvedValue({ error: null });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /magic link/i }));
    // Password field is hidden in magic-link mode.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'magic@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(signInOtpMock).toHaveBeenCalledTimes(1));
    expect(signInOtpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'magic@example.com',
        options: expect.objectContaining({
          emailRedirectTo: expect.stringContaining('/'),
        }),
      }),
    );
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });
});
