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
      ],
      // Floor, not target. Current is ~23% lines / 20% branches; thresholds
      // are set just below so PRs can't silently regress. Ratchet up as
      // coverage grows. Run locally: `npm run test:coverage`.
      thresholds: {
        lines: 20,
        statements: 20,
        functions: 18,
        branches: 18,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
