import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignupPage } from '@/features/auth/SignupPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { RosterPage } from '@/features/patients/RosterPage';
import { PatientDetailPage } from '@/features/patients/PatientDetailPage';
import { AlertsPage } from '@/features/alerts/AlertsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/patients" replace />} />
              <Route path="/patients" element={<RosterPage />} />
              <Route path="/patients/:id" element={<PatientDetailPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/history" element={<ReportsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
