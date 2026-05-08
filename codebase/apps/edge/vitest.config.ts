import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Item 89 wire: handlers now import via the deno.json import map.
      // Mirror those entries here so vitest can resolve the same paths.
      '@alzcare/shared/mqtt': resolve(__dirname, '../../packages/shared/src/mqtt/index.ts'),
      '@alzcare/shared/positioning': resolve(
        __dirname,
        '../../packages/shared/src/positioning/index.ts',
      ),
      '@alzcare/shared/rules': resolve(__dirname, '../../packages/shared/src/rules/index.ts'),
      '@alzcare/shared/db': resolve(__dirname, '../../packages/shared/src/db/index.ts'),
      '@alzcare/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
