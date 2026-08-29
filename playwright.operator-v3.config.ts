import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], channel: 'chrome'}}],
});
