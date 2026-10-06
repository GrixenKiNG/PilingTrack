import {defineConfig} from '@playwright/test';

/**
 * Прогон №9 — живой браузер для /operator/next в телефонной рамке.
 *
 * ПОРТ. Задание №9 просило dev-сервер на 3200, но 127.0.0.1:3200 занят чужим
 * изолированным стендом аудита (контейнер pt-audit-app, останавливать нельзя),
 * а dev-режим этого worktree технически не запускается: Turbopack отвергает
 * вынесенный node_modules (junction на D:\PillingR\my-project), webpack-dev
 * падает на необязательных модулях. Свой сервер поднят сборкой этого же кода
 * (штатный webpack-путь репозитория) на 3210 — см. отчёт №9, раздел о стенде.
 * Адрес переопределяется переменной OPNEXT_BASE_URL.
 */
export default defineConfig({
  testDir: './e2e/operator-next',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.OPNEXT_BASE_URL ?? 'http://localhost:3210',
    viewport: {width: 375, height: 812},
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
});
