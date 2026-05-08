import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

import { ProtectedRoute } from '@/features/auth/ProtectedRoute';

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard</div>} />
          <Route path="/patients/:id" element={<div>Patient detail</div>} />
        </Route>
        <Route path="/login" element={<LoginSpy />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Login route under test — captures the pathname + state.from the
 *  redirect lands with so the test can assert the deep-link is
 *  preserved for the post-login bounce. */
let lastLoginState: unknown = null;
let lastLoginPathname: string | null = null;
function LoginSpy() {
  // useLocation comes from react-router-dom; access via the hook so we
  // don't have to import it twice.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useLocation } = require('react-router-dom') as typeof import('react-router-dom');
  const loc = useLocation();
  lastLoginState = loc.state;
  lastLoginPathname = loc.pathname;
  return <div>Login page</div>;
}

beforeEach(() => {
  useAuthMock.mockReset();
  lastLoginState = null;
  lastLoginPathname = null;
});

describe('ProtectedRoute', () => {
  it('renders a loading sentinel while auth is in flight', () => {
    useAuthMock.mockReturnValue({ session: null, user: null, loading: true });
    renderAt('/dashboard');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });

  it('renders nested route children when the caller has an active session', () => {
    useAuthMock.mockReturnValue({
      session: { user: { id: 'u1' } },
      user: { id: 'u1' },
      loading: false,
    });
    renderAt('/dashboard');
    expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
  });

  it('redirects to /login when there is no session, preserving the original location as state.from', () => {
    useAuthMock.mockReturnValue({ session: null, user: null, loading: false });
    renderAt('/patients/abc');
    expect(screen.getByText(/login page/i)).toBeInTheDocument();
    expect(lastLoginPathname).toBe('/login');
    // ProtectedRoute passes the original location object as state.from so
    // LoginPage can `navigate(state.from.pathname)` after sign-in.
    expect((lastLoginState as { from?: { pathname?: string } } | null)?.from?.pathname).toBe(
      '/patients/abc',
    );
  });
});
