import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
// Phase H item 75: self-host the two display fonts via @fontsource so
// the dashboard no longer hits fonts.googleapis.com on every cold load.
// Removes the referrer-leak that an Australian-privacy reviewer would
// flag for a clinical-data app, and is faster on first paint because
// the browser doesn't open an extra TLS connection. The Tailwind
// `font-sans` and `font-serif` declarations in globals.css already
// reference the family names these CSS files register.
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import { App } from './App';
import { RootErrorBoundary } from './components/RootErrorBoundary';
import { queryClient } from './lib/queryClient';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster richColors closeButton position="top-right" />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
