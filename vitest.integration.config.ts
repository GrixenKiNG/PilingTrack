import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Explicit opt-in only. This configuration never loads .env files.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/integration/disposable-*.spec.ts', 'tests/integration/tech-readiness-write-pipeline.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
