import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LandingPage } from '@/features/patients/LandingPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<LandingPage />} />
            {/* TODO: F2 — /patients roster route. */}
            {/* TODO: F3 — /patients/:id detail dashboard with tabbed body. */}
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
