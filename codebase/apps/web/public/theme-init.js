/* global window, document */
// Apply theme before React mounts to avoid a flash of the wrong palette.
// Mirrors apps/web/src/lib/theme.ts. Served from the app origin (not inline)
// so it satisfies `script-src 'self'` without weakening the CSP.
(function () {
  try {
    var stored = window.localStorage.getItem('alzcare-theme');
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    if (theme === 'light') document.documentElement.classList.add('light');
  } catch {
    /* default dark — do nothing */
  }
})();
