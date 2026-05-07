/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
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
});
