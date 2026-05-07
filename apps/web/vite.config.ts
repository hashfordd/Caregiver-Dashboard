import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import type { UserConfig as VitestUserConfig } from 'vitest/config';

// Vitest 2.1.9 ships its own bundled copy of vite under .deno/, so importing
// `defineConfig` from 'vitest/config' re-exports a typed config that
// references a *different* Vite copy than the one our plugins resolve to.
// Result: a Plugin<any> type-mismatch on `plugins:`. Cast the merged config
// against vite's UserConfig + vitest's UserConfig['test'] to keep both sides
// type-checked without dragging in the duplicate vite type tree.
const config: UserConfig & { test: VitestUserConfig['test'] } = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@alzcare/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
    // Some transitive deps (e.g. react-smooth via recharts) declare
    // react as a hard dependency rather than a peer, which causes npm
    // to install a second copy of React deeper in node_modules. Vite's
    // pre-bundler then resolves both copies — `react.useState` from
    // copy A is null inside a hook called from copy B's render. Force
    // a single React instance across all imports.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
};

export default defineConfig(config);
