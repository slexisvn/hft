import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = process.cwd();
const src = (p: string): string => resolve(root, p, 'src/index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@hft/contracts': src('packages/contracts'),
      '@hft/events': src('packages/events'),
      '@hft/book': src('packages/book'),
      '@hft/metrics': src('packages/metrics'),
      '@hft/numeric': src('packages/numeric'),
      '@hft/sim': src('packages/sim'),
      '@hft/strategy': src('packages/strategy'),
      '@hft/live': src('packages/live'),
      '@hft/lobster': src('packages/adapters/lobster'),
      '@hft/binance': src('packages/adapters/binance'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
