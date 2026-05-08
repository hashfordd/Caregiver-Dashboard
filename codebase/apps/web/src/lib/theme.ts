import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'alzcare-theme';

function safeReadPersisted(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function safeWritePersisted(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* noop */
  }
}

function detectSystem(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyToDocument(theme: Theme): void {
  const html = document.documentElement;
  if (theme === 'light') html.classList.add('light');
  else html.classList.remove('light');
}

/**
 * Theme is the dashboard's per-device UI preference. Persists to
 * localStorage so the choice survives page reload; an inline script in
 * `index.html` reads the same key before React mounts to avoid a flash of
 * the wrong palette.
 *
 * If cross-device sync is wanted later, mirror the value into a
 * `caregivers.theme` column — see BACKLOG.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => safeReadPersisted() ?? detectSystem());

  useEffect(() => {
    applyToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    safeWritePersisted(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      safeWritePersisted(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}
