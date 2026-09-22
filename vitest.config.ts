import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import react from '@vitejs/plugin-react';

/**
 * Интеграционные спеки гейтятся на живой базе: нет URL — `describe.skipIf`
 * молча пропускает набор. Vitest сам `.env` не читает, поэтому локально гейт
 * не открывался никогда: прогон был зелёным, ничего не проверив (вскрылось
 * 22.09.2026 на RLS-тесте изоляции тенантов).
 *
 * Сюда переносятся ТОЛЬКО адреса базы — остальное из `.env` в тесты не
 * попадает, чтобы юнит-тесты продолжали идти в вакууме. Уже заданное
 * окружение главнее файла: так CI задаёт свои адреса.
 */
const DB_ENV_KEYS = ['DATABASE_URL_POSTGRES', 'DATABASE_URL_APP_ROLE'] as const;

function dbEnvFromDotenv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) return {};
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return Object.fromEntries(
    DB_ENV_KEYS.filter((k) => !process.env[k] && parsed[k]).map((k) => [k, parsed[k]])
  );
}

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    env: dbEnvFromDotenv(),
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
      // Ratchet floor, not target. Set just below current actual (lines 24.1 /
      // statements 23.3 / functions 19.9 / branches 19.6) so a PR that adds
      // code without tests trips the gate. Bump these up whenever coverage
      // grows — never down without a deliberate reason. Run: `npm run test:coverage`.
      thresholds: {
        lines: 24,
        statements: 23,
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
