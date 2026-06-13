import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'tests/contract/**/*.spec.ts',
      'tests/integration/**/*.spec.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'tests/e2e/**',
      'tests/chaos/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/generated/**',
        'src/test/**',
        '**/*.d.ts',
        '**/*.config.{ts,js}',
        'src/components/ui/**', // shadcn primitives — не требуют unit-тестов
        // Dormant MQTT ingestion (activates only with telemetry hardware) trips a
        // rolldown PARSE_ERROR in the v8 coverage remapper on the uncovered file,
        // which aborts the whole report. It's 0% either way; excluding it keeps
        // `npm run test:coverage` runnable.
        'src/services/telemetry/mqtt-ingestion-service.ts',
      ],
      // Ratchet floor, not target. Set just below current actual (lines 23.3 /
      // statements 22.5 / functions 19.2 / branches 19.2) so a PR that adds
      // code without tests trips the gate. Bump these up whenever coverage
      // grows — never down without a deliberate reason. Run: `npm run test:coverage`.
      thresholds: {
        lines: 23,
        statements: 22,
        functions: 19,
        branches: 19,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
