import { QueryClient } from '@tanstack/react-query';

// Single QueryClient instance shared across the app and tests.
// 30s staleTime is the right default for server state (per CROSS_CUTTING §7);
// realtime updates trigger explicit invalidations rather than re-fetches.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry 4xx — surface the error to the caller.
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
