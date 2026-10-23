/** Synthetic reports must agree in the list, preview, journal and analytics. */
import { test, expect } from '@playwright/test';
import { login, qaHistory } from '../qa/helpers';
import { kpiTiles, parseCountMeters } from './util';

test('админка: три сегодняшних отчёта — список, карточка, PDF', async ({ page }) => {
  test.setTimeout(240_000);
  const history = qaHistory();
  await login(page, 'dispatch@piling.ru');
  await page.goto('/admin/reports');
  for (const report of history.reports) {
    const row = page.locator('div.grid.gap-3.px-3.py-3').filter({ hasText: report.operator });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Показать в правой панели' }).click();
    await expect(page.getByRole('heading', { name: `Отчёт #${report.id}`, exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Скачать', exact: true }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).subarray(0, 4).toString('latin1')).toBe('%PDF');
  }
});

test('журнал забивки: NEW-5 — синтетические паспорта и записи без паспорта', async ({ page }) => {
  const history = qaHistory();
  await login(page, 'dispatch@piling.ru');
  await page.goto('/admin/reports?view=piles');
  await expect(page.getByRole('heading', { name: 'Журнал забивки свай' })).toBeVisible();
  for (const report of history.reports) await expect(page.getByText(report.pileNumber, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('без паспорта', { exact: true })).toHaveCount(history.reports.length);
});

test('карточка Banut 655: NEW-6 — сваи синтетической смены в таблице', async ({ page }) => {
  const history = qaHistory();
  const report = history.reports.find(r => r.equipment === 'Banut 655');
  if (!report) throw new Error('Missing Banut fixture');
  await login(page, 'dispatch@piling.ru');
  await page.goto(`/admin/equipment/${report.equipmentId}`);
  const table = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Свай', exact: true }) });
  await expect(table).toBeVisible();
  const columns = (await table.getByRole('columnheader').allTextContents()).map(s => s.trim().toUpperCase());
  const [year, month, day] = history.date.split('-');
  const row = table.locator('tbody tr').filter({ hasText: `${day}.${month}.${year}` });
  await expect(row).toHaveCount(1);
  expect(columns.indexOf('СВАЙ')).toBeGreaterThanOrEqual(0);
  await expect(row.locator('td').nth(columns.indexOf('СВАЙ'))).toHaveText(String(report.piles));
});

test('главная панель и аналитика: числа дня и отчёты операторов', async ({ page }) => {
  const history = qaHistory();
  await login(page, 'qa-hermes-admin@piling.test');
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect.poll(async () => parseCountMeters((await kpiTiles(page))['Сваи'] ?? ''), { timeout: 30_000 }).toEqual({ count: history.totalPiles, meters: history.totalPileMeters });
  await expect.poll(async () => parseCountMeters((await kpiTiles(page))['Бурение'] ?? ''), { timeout: 30_000 }).toEqual({ count: history.drillingCount, meters: history.drillingMeters });
  await page.goto('/admin/analytics');
  for (const report of history.reports) await expect(page.getByText(report.operator, { exact: true }).first()).toBeVisible();
});
