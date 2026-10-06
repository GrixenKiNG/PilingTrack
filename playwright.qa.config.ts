/**
 * Ежедневный QA (владелец 27.09.2026): автоматические сценарии против
 * ЛОКАЛЬНОГО приложения http://localhost:3000 с тестовой базой.
 * Запускает D:/PillingR/qa/qa-daily.ps1; результаты — в QA_RUN_DIR/playwright.
 * Матрица пользователей и пароли — D:/PillingR/qa (в git не попадают).
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const runDir = process.env.QA_RUN_DIR || path.join('D:/PillingR/qa/runs', 'manual');
const out = path.join(runDir, 'playwright');

export default defineConfig({
  testDir: './e2e/qa',
  // Дев-сервер компилирует страницы по первому запросу — щедрые тайм-ауты.
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: path.join(out, 'artifacts'),
  reporter: [['json', { outputFile: path.join(out, 'results.json') }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    screenshot: 'only-on-failure',
    trace: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /operator-/ },
    { name: 'phone', use: { ...devices['Galaxy S20'] }, testMatch: /operator-/ },
  ],
});
