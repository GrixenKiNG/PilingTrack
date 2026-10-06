/**
 * Блок E задания №5: одинаковые цифры на трёх экранах.
 *
 * «Весь период»: «Сваи» и «Бурение» на дашборде, в «Объектах» (Сваи факт /
 * Бурение факт) и в «Отчётах» — одни и те же числа, везде в виде «N шт. / M м.п.».
 */
import { expect, test } from '@playwright/test';
import { login, matrix } from '../qa/helpers';
import { kpiTiles, parseCountMeters, pause, writeRunJson, expectDefined } from './util';

const ADMIN = expectDefined(matrix.roles.find((r) => r.role === 'ADMIN'), 'ADMIN role not found in matrix').email;

/** Плитки с ожиданием: дашборд рисует скелет, пока грузятся данные. */
async function tilesWith(page: import('@playwright/test').Page, needed: string[], tries = 25) {
  let tiles: Record<string, string> = {};
  for (let i = 0; i < tries; i++) {
    tiles = await kpiTiles(page);
    if (needed.every((k) => tiles[k])) return tiles;
    await pause(page, 1000);
  }
  return tiles;
}

const keysInfo = (t: Record<string, string>) => `найдены плитки: ${Object.keys(t).join(' / ') || 'ни одной'}`;

test('E: «Сваи» и «Бурение» совпадают на дашборде, в объектах и отчётах', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  await login(page, ADMIN);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Весь период', exact: true }).click();
  await pause(page, 1500);
  const dash = await tilesWith(page, ['Сваи', 'Бурение']);
  writeRunJson('kpi-dump.json', { phase: 'dash', dash });
  const dPiles = parseCountMeters(dash['Сваи'] ?? '');
  const dDrill = parseCountMeters(dash['Бурение'] ?? '');
  expect(dPiles, `дашборд «Сваи»: «${dash['Сваи']}»; ${keysInfo(dash)}`).toBeTruthy();
  expect(dDrill, `дашборд «Бурение»: «${dash['Бурение']}»; ${keysInfo(dash)}`).toBeTruthy();

  await page.goto('/admin/sites');
  await expect(page.getByRole('heading', { name: 'Объекты' })).toBeVisible({ timeout: 90_000 });
  const sites = await tilesWith(page, ['Сваи факт', 'Бурение факт']);
  writeRunJson('kpi-dump.json', { phase: 'sites', dash, sites });
  const sPiles = parseCountMeters(sites['Сваи факт'] ?? '');
  const sDrill = parseCountMeters(sites['Бурение факт'] ?? '');
  expect(sPiles, `объекты «Сваи факт»: «${sites['Сваи факт']}»; ${keysInfo(sites)}`).toBeTruthy();
  expect(sDrill, `объекты «Бурение факт»: «${sites['Бурение факт']}»; ${keysInfo(sites)}`).toBeTruthy();

  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible({ timeout: 90_000 });
  const rep = await tilesWith(page, ['Сваи', 'Бурение']);
  writeRunJson('kpi-dump.json', { phase: 'reports', dash, sites, rep });
  const rPiles = parseCountMeters(rep['Сваи'] ?? '');
  const rDrill = parseCountMeters(rep['Бурение'] ?? '');
  expect(rPiles, `отчёты «Сваи»: «${rep['Сваи']}»; ${keysInfo(rep)}`).toBeTruthy();
  expect(rDrill, `отчёты «Бурение»: «${rep['Бурение']}»; ${keysInfo(rep)}`).toBeTruthy();

  const dPilesCount = expectDefined(dPiles, 'dPiles missing after check').count;
  const dPilesMeters = expectDefined(dPiles, 'dPiles missing after check').meters;
  const dDrillCount = expectDefined(dDrill, 'dDrill missing after check').count;
  const dDrillMeters = expectDefined(dDrill, 'dDrill missing after check').meters;
  const sPilesCount = expectDefined(sPiles, 'sPiles missing after check').count;
  const sPilesMeters = expectDefined(sPiles, 'sPiles missing after check').meters;
  const sDrillCount = expectDefined(sDrill, 'sDrill missing after check').count;
  const sDrillMeters = expectDefined(sDrill, 'sDrill missing after check').meters;
  const rPilesCount = expectDefined(rPiles, 'rPiles missing after check').count;
  const rPilesMeters = expectDefined(rPiles, 'rPiles missing after check').meters;
  const rDrillCount = expectDefined(rDrill, 'rDrill missing after check').count;
  const rDrillMeters = expectDefined(rDrill, 'rDrill missing after check').meters;

  const rows: Array<{ name: string; ok: boolean; note: string }> = [];
  const cmp = (label: string, x: number | undefined, y: number | undefined) => {
    const okl = x != null && y != null && Math.abs(x - y) <= (Number.isInteger(x) ? 0.001 : 0.06);
    rows.push({ name: label, ok: okl, note: `${x} против ${y}` });
    expect.soft(okl, `${label}: ${x} против ${y}`).toBe(true);
  };
  cmp('сваи шт.: дашборд = объекты', dPilesCount, sPilesCount);
  cmp('сваи шт.: дашборд = отчёты', dPilesCount, rPilesCount);
  cmp('сваи м.п.: дашборд = объекты', dPilesMeters, sPilesMeters);
  cmp('сваи м.п.: дашборд = отчёты', dPilesMeters, rPilesMeters);
  cmp('бурение шт.: дашборд = объекты', dDrillCount, sDrillCount);
  cmp('бурение шт.: дашборд = отчёты', dDrillCount, rDrillCount);
  cmp('бурение м.п.: дашборд = объекты', dDrillMeters, sDrillMeters);
  cmp('бурение м.п.: дашборд = отчёты', dDrillMeters, rDrillMeters);

  writeRunJson('kpi-consistency.json', { generatedAt: new Date().toISOString(), dash, sites, rep, rows });
});
