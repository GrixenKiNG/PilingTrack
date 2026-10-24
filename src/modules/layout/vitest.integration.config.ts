import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Explicit opt-in: needs scripts/test-db-up.sh's owned disposable database. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src') } },
  test: {
    environment: 'node',
    include: ['src/modules/layout/__tests__/*.integration.ts'],
    maxWorkers: 1,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
