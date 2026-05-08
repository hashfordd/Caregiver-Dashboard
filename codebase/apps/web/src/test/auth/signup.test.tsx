import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: signUpMock,
    },
  },
}));

import { SignupPage } from '@/features/auth/SignupPage';

describe('SignupPage', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('renders all required fields and the role select', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('forwards full_name and role through options.data on submit', async () => {
    signUpMock.mockResolvedValue({
      data: { session: { access_token: 'mock' } },
      error: null,
    });

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass1234' } });
    // Role uses a Radix Select; default 'family' is sufficient to verify
    // options.data plumbing — Radix interaction is exercised in the
    // browser smoke pass, not in jsdom.
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    const args = signUpMock.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      email: 'jane@example.com',
      password: 'pass1234',
      options: {
        data: { full_name: 'Jane Doe', role: 'family' },
      },
    });
  });

  it('renders a server error message when signUp fails', async () => {
    signUpMock.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Email already registered' },
    });

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'x@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass1234' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/email already registered/i)).toBeInTheDocument();
  });

  it('switches to the verify-email view when no session is returned', async () => {
    signUpMock.mockResolvedValue({
      data: { session: null, user: { id: 'pending' } },
      error: null,
    });

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'verify@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass1234' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/verify@example\.com/)).toBeInTheDocument();
  });
});
