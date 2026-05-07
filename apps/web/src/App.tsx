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
import { OnboardingPage } from '@/features/provider/OnboardingPage';
import { ProviderSettingsPage } from '@/features/provider/ProviderSettingsPage';
import { AcceptInvitePage } from '@/features/provider/AcceptInvitePage';
import { RequireProviderBound } from '@/features/provider/RequireProviderBound';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Authenticated but not yet provider-bound — onboarding +
                invite-acceptance live above the provider gate. */}
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route element={<RequireProviderBound />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/patients" replace />} />
                <Route path="/patients" element={<RosterPage />} />
                <Route path="/patients/:id" element={<PatientDetailPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/history" element={<ReportsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/provider" element={<ProviderSettingsPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
