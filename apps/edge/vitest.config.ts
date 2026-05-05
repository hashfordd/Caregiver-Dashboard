import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@alzcare/shared/mqtt': resolve(__dirname, '../../packages/shared/src/mqtt/index.ts'),
      '@alzcare/shared/positioning': resolve(
        __dirname,
        '../../packages/shared/src/positioning/index.ts',
      ),
      '@alzcare/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
