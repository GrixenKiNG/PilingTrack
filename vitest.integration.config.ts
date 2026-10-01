import { defineConfig } from 'vitest/config';

// Explicit opt-in only. This configuration never loads .env files.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/disposable-*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
