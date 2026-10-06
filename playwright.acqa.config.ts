/**
 * Ночные автотесты AutoClaw №5 (задание 28.09.2026): роли, права, запись данных,
 * экспорт до файла, мобильная вёрстка 375px, клавиатура, заголовки безопасности.
 *
 * Копия playwright.qa.config.ts с другим каталогом тестов. Вывод — в
 * D:/PillingR/qa/runs/autoclaw-<дата> (переопределяется QA_RUN_DIR). Приложение
 * — только http://localhost:3000 (локальная тестовая база).
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const day = process.env.QA_RUN_DAY || new Date().toISOString().slice(0, 10);
const runDir = process.env.QA_RUN_DIR || path.join('D:/PillingR/qa/runs', `autoclaw-${day}`);
const out = path.join(runDir, 'playwright');

export default defineConfig({
  testDir: './e2e/qa-ac',
  // Дев-сервер компилирует страницы по первому запросу — щедрые тайм-ауты.
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(out, 'artifacts'),
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    screenshot: 'only-on-failure',
    trace: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
  },
  projects: [{ name: 'qa-ac', use: { ...devices['Desktop Chrome'] } }],
});
