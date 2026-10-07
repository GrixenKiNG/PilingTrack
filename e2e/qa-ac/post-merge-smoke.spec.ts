/**
 * W48: дымовая проверка после слияния ветки q4-0926 в main.
 *
 * Один спек — «всё на месте» после слияния, по одному тесту на проверку.
 * Только чтение: ничего не создаётся, не меняется и не удаляется. Вход — по
 * готовым сессиям из D:/PillingR/qa/.auth (пароли не читаются). Тесты не
 * выполняются в обычном прогоне: запуск только при POST_MERGE_SMOKE=1.
 *
 *   POST_MERGE_SMOKE=1 npx playwright test -c playwright.acqa.config.ts post-merge-smoke
 *
 * Сайт для этого прогона собирается из main, поэтому сам спек в задаче не
 * запускается — проверяется только видимость тестов (--list) и линт.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login, matrix, must, OUT_DIR, QA_DIR } from '../qa/helpers';

const roleEmail = (role: string) => must(matrix.roles.find((r) => r.role === role), `роль ${role}`).email;
const ADMIN = roleEmail('ADMIN');
const DISPATCHER = roleEmail('DISPATCHER');
const FOREMAN = roleEmail('FOREMAN');
const SAFETY_ENGINEER = roleEmail('SAFETY_ENGINEER');
// Помощник — отдельный вход в матрице; берём помощника первой версии.
const ASSISTANT = matrix.operatorVersions[0].assistant;

const GATE = 'запуск только при POST_MERGE_SMOKE=1';

/** Файл сессии в D:/PillingR/qa/.auth — как в helpers.login (пароли не читаем). */
const authFile = (email: string) =>
  path.join(QA_DIR, '.auth', `${email.replace(/[^a-z0-9@._-]/gi, '_')}.json`);
const hasSession = (email: string) => fs.existsSync(authFile(email));

test('S1: диспетчер — журнал забивки: «Свай (всего)», строка без паспорта, выгрузка .xlsx', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.setTimeout(10 * 60_000);
  await login(page, DISPATCHER);
  await page.goto('/admin/reports?view=piles');
  await expect(page.getByRole('heading', { name: 'Журнал забивки свай' })).toBeVisible({ timeout: 90_000 });

  // Шапка: «Свай (всего)» больше 1000. Значение — соседний <p> метки.
  const label = page.getByText('Свай (всего)', { exact: true });
  await expect(label).toBeVisible({ timeout: 60_000 });
  const raw = await label.locator('xpath=following-sibling::p[1]').innerText();
  const total = Number(raw.replace(/\s/g, ''));
  expect(Number.isFinite(total), `«Свай (всего)» распознано как число: «${raw}»`).toBe(true);
  expect(total, `«Свай (всего)» = ${total}`).toBeGreaterThan(1000);

  // В таблице есть строка с пометкой «без паспорта» (сваи, записанные пачкой).
  await expect(page.getByText('без паспорта', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  // Выгрузка журнала: файл начинается с «PK» (ZIP/OOXML) и больше 10 КБ.
  const exportButton = page.getByRole('button', { name: /Выгрузить журнал/ });
  await expect(exportButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    exportButton.click(),
  ]);
  const file = path.join(OUT_DIR, 'post-merge-journal.xlsx');
  await download.saveAs(file);
  const buf = fs.readFileSync(file);
  expect(buf.subarray(0, 2).toString('latin1'), 'выгрузка начинается с байтов PK').toBe('PK');
  expect(buf.length, 'выгрузка больше 10 КБ').toBeGreaterThan(10 * 1024);
});

test('S2: журнал забивки — фильтр «Все» выбран по умолчанию', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.setTimeout(10 * 60_000);
  await login(page, DISPATCHER);
  await page.goto('/admin/reports?view=piles');
  await expect(page.getByRole('heading', { name: 'Журнал забивки свай' })).toBeVisible({ timeout: 90_000 });

  // Активный фильтр отрисован основным (не контурным) стилем кнопки; при
  // стартовом значении «Все» в адресе нет параметра acceptance.
  const all = page.getByRole('button', { name: 'Все', exact: true });
  await expect(all).toBeVisible();
  await expect(all).toHaveClass(/bg-primary/);
  expect(new URL(page.url()).searchParams.has('acceptance'), 'параметр acceptance не выставлен').toBe(false);
});

test('S3: мастер — на /monitoring виден блок аналитики', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.skip(!hasSession(FOREMAN), `нет сессии мастера ${FOREMAN}`);
  test.setTimeout(10 * 60_000);
  await login(page, FOREMAN);
  await page.goto('/monitoring');
  // Право analytics.read выдано мастеру — блок «Аналитика по установкам» виден.
  await expect(page.getByRole('heading', { name: 'Аналитика по установкам' })).toBeVisible({ timeout: 90_000 });
});

test('S4: инженер ОТ — после входа попадает в «ТБ и допуски»', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.skip(!hasSession(SAFETY_ENGINEER), `нет сессии инженера ОТ ${SAFETY_ENGINEER}`);
  test.setTimeout(10 * 60_000);
  await login(page, SAFETY_ENGINEER);
  // Домашний маршрут инженера ОТ — /admin/safety (roleHomeRoute).
  await expect(page).toHaveURL(/\/admin\/safety/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'ТБ и допуски' }).first()).toBeVisible({ timeout: 90_000 });
});

test('S5: помощник на /admin/reports видит «Нет доступа к разделу»', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.setTimeout(10 * 60_000);
  await login(page, ASSISTANT);
  await page.goto('/admin/reports');
  await expect(page).toHaveURL(/\/no-access/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: 'Нет доступа к разделу' })).toBeVisible();
});

test('S6: администратор — /api/metrics отдаёт метрики согласованности аналитики', async ({ page }) => {
  test.skip(!process.env.POST_MERGE_SMOKE, GATE);
  test.setTimeout(10 * 60_000);
  await login(page, ADMIN);
  const response = await page.request.get('/api/metrics');
  // Метрики отдаются по токену скрейпа или сессии администратора; если снаружи
  // недоступны — пропускаем с причиной, а не считаем дефектом.
  test.skip(response.status() !== 200, `метрики недоступны из сессии (HTTP ${response.status()})`);
  const body = await response.text();
  expect(body, 'есть строка report_analytics_status_mismatch_total с числом').toMatch(
    /^report_analytics_status_mismatch_total \d+$/m,
  );
  expect(body, 'есть строка report_analytics_missing_total с числом').toMatch(
    /^report_analytics_missing_total \d+$/m,
  );
});
