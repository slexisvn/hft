import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));
const engine = (path: string): string => resolve(here, '..', path);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@hft/contracts': engine('packages/contracts/src/index.ts'),
      '@hft/live/stats': engine('packages/live/src/stats.ts'),
      '@hft/numeric/gate': engine('packages/numeric/src/gate.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.tsx'],
  },
});
