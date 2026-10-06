/**
 * Задание №12, сверка «всё на месте»: три сегодняшних отчёта операторов видны
 * в админке (список, карточка, PDF), находки NEW-5 (журнал забивки) и NEW-6
 * (карточка Banut 655), панель и аналитика. Только чтение; скриншоты и дампы —
 * docs/qa-autoclaw/walk-1006 (png не коммитятся).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { login } from '../qa/helpers';

const WALK = 'D:/PillingR/wt-autoclaw/docs/qa-autoclaw/walk-1006';
const LOGS = path.join(WALK, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const DATA = path.join(WALK, 'walk-data.json');

function db(sql: string): string {
  return execSync(
    'docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -At -v ON_ERROR_STOP=1',
    { input: sql, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  ).trim();
}

function record(entry: Record<string, unknown>) {
  const all = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : [];
  all.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(DATA, JSON.stringify(all, null, 1), 'utf8');
  console.log('[record]', JSON.stringify(entry).slice(0, 500));
}

async function strip(page: Page) {
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove()));
}

async function tap(page: Page, target: Locator, note = '') {
  await strip(page);
  try {
    await target.click({ timeout: 15_000 });
  } catch {
    await strip(page);
    await target.click({ force: true, timeout: 15_000 });
  }
  await page.waitForTimeout(600);
  if (note) console.log('[tap]', note);
}

async function dump(page: Page, name: string): Promise<string> {
  const txt = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(LOGS, `${name}.txt`), txt, 'utf8');
  await page.screenshot({ path: path.join(WALK, `${name}.png`), fullPage: false }).catch(() => undefined);
  console.log(`[dump ${name}]`, txt.replace(/\s+/g, ' ').slice(0, 260));
  return txt;
}

const REPORTS = [
  { id: 'RM-673a209d-2026-10-06', operator: 'Иванов', range: '19:18 - 19:26', equipment: 'Bauer RTG RM20' },
  { id: 'RM-ec19a322-2026-10-06', operator: 'Щеголев', range: '17:14 - 17:43', equipment: 'Banut 655' },
  { id: 'RM-9f5b221c-2026-10-06', operator: 'Краснов', range: '14:55 - 18:53', equipment: 'КБУРГ-16.02 №1' },
];

test('админка: три сегодняшних отчёта — список, карточка, PDF', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await login(page, 'dispatch@piling.ru');
  await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await dump(page, 'everywhere-01-отчёты-список');
  const today = page.getByRole('button', { name: 'Сегодня' });
  if (await today.count()) { await tap(page, today.first(), 'фильтр Сегодня'); await page.waitForTimeout(3000); }
  const txt = await dump(page, 'everywhere-02-отчёты-сегодня');

  const found: Record<string, boolean> = {};
  for (const rep of REPORTS) found[rep.id] = txt.includes(rep.operator);
  record({ step: 'отчёты-список', found, фрагмент: txt.replace(/\s+/g, ' ').slice(0, 500) });
  for (const rep of REPORTS) {
    expect(txt, `отчёт ${rep.operator} (${rep.id}) виден в списке за сегодня`).toContain(rep.operator);
  }

  // Карточки: каждая проверяется на свежезагруженном списке; «Подробнее» по индексу строки
  const seenIds: string[] = [];
  for (let idx = 0; idx < REPORTS.length; idx++) {
    const rep = REPORTS[idx];
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4200);
    const todayBtn = page.getByRole('button', { name: 'Сегодня' });
    if (await todayBtn.count()) { await tap(page, todayBtn.first(), 'Сегодня'); await page.waitForTimeout(2200); }
    const row = page.locator('div.grid.gap-3.px-3.py-3').filter({ hasText: rep.range }).first();
    await row.hover().catch(() => undefined);
    await tap(page, row.getByRole('button', { name: 'Показать в правой панели' }).first(), `в панель: ${rep.operator}`);
    await page.waitForTimeout(2500);
    const card = await dump(page, `everywhere-03-карточка-${idx}-${rep.operator}`);
    record({ step: 'карточка', ожидался: rep.id, найден: (card.match(/RM-[a-f0-9]+-2026-10-06/) ?? [''])[0] });
    expect(card, `карточка ${rep.id} (${rep.operator})`).toContain(rep.id);
    const m = card.match(/RM-[a-f0-9]+-2026-10-06/);
    if (m) seenIds.push(m[0]);
  }
  // PDF: «Скачать» в панели; тело начинается с %PDF
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    tap(page, page.getByRole('button', { name: 'Скачать' }).first(), 'скачать PDF'),
  ]);
  const file = await download.path();
  const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
  record({ step: 'PDF', файл: download.suggestedFilename(), начало: head });
  expect(head, 'PDF начинается с %PDF').toBe('%PDF');
});

test('журнал забивки: NEW-5 — реальные сваи 04.10 против только AC-QA', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await login(page, 'dispatch@piling.ru');
  await page.goto('/admin/reports?view=piles', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await dump(page, 'everywhere-04-журнал-забивки');
  const wk = page.getByRole('button', { name: '7 дней' });
  if (await wk.count()) { await tap(page, wk.first(), '7 дней'); await page.waitForTimeout(3000); }
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1200);
  const txt = await dump(page, 'everywhere-05-журнал-7дней');
  const естьACQA = /AC-QA/.test(txt);
  const есть0410 = /QA_HERMES QA-20261004/.test(txt);
  record({ step: 'NEW-5', естьACQA, есть0410, фрагмент: txt.replace(/\s+/g, ' ').slice(0, 700) });
  // Ожидание: сваи отчётов 04.10 (QA_HERMES QA-20261004-0300, «80») видны в журнале.
  // Журнал строится из записей выработки (W14), поэтому «пачки» 04.10 на месте.
  expect(txt, 'ОЖИДАЛОСЬ: сваи отчётов 04.10 в журнале забивки; получилось: только AC-QA-строки').toMatch(/QA_HERMES QA-20261004|8cdc3ef8|97cf60c1|38354c90/i);
});

test('карточка Banut 655: NEW-6 — сваи за 04.10 в таблице смен', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const banut = db(`SELECT id FROM "Equipment" WHERE name ILIKE '%Banut%' ORDER BY "createdAt" LIMIT 1`);
  record({ step: 'NEW-6', banutId: banut });
  await login(page, 'dispatch@piling.ru');
  await page.goto(`/admin/equipment/${banut}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 1700);
  await page.waitForTimeout(1200);
  const txt = await dump(page, 'everywhere-06-банут');
  const db0410 = db(`SELECT COALESCE(SUM(count),0) || '|' || COALESCE(SUM(count*14),0) FROM "PileWork" WHERE "shiftId"='38354c90-8e45-4e5c-a3bb-aa67ab520da9' AND "pileGradeId" IS NOT NULL`);
  record({ step: 'NEW-6', вБане: db0410, фрагмент: txt.replace(/\s+/g, ' ').slice(-1200) });

  // Строку 04.10 видно только в развёрнутой истории.
  const expand = page.getByRole('button', { name: /Показать всю историю/ });
  if (await expand.count()) { await tap(page, expand.first(), 'развернуть историю'); await page.waitForTimeout(600); }

  // Читаем колонку «Свай» строки 04.10 по заголовку колонки, а не по позиции:
  // прошлый обход принял за сваи соседнюю колонку «Бурение» с «0,0».
  const history = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Свай', exact: true }) }).first();
  const headers = (await history.locator('thead th').allInnerTexts()).map((h) => h.trim().toUpperCase());
  const colIdx = headers.indexOf('СВАЙ');
  expect(colIdx, 'в таблице истории карточки есть колонка «Свай»').toBeGreaterThanOrEqual(0);
  const rows0410 = history.locator('tbody tr').filter({ hasText: '04.10.2026' });
  await expect(rows0410, 'в истории карточки есть строка 04.10.2026').toHaveCount(1);
  const cell = (await rows0410.first().locator('td').nth(colIdx).innerText()).trim();
  record({ step: 'NEW-6', колонкаСвай: cell, строка: (await rows0410.first().innerText()).replace(/\s+/g, ' ') });
  // В базе за 04.10 — 2 сваи (`2|28`). Карточка показывает в колонке «Свай» 2,
  // а «0,0» стоит в колонке «Бурение» — дефекта нет.
  expect(cell, 'за 04.10 в колонке «Свай» карточки Banut 655 — 2 (не «0,0» из «Бурения»)').toBe('2');
});

test('главная панель и аналитика: числа дня и отчёты операторов', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await login(page, 'qa-hermes-admin@piling.test');
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const dash = await dump(page, 'everywhere-07-панель');
  const submittedToday = db(`SELECT COUNT(*) FROM "Report" WHERE status='submitted' AND "submittedAt" >= '2026-10-06'`);
  record({ step: 'панель', submittedToday, фрагмент: dash.replace(/\s+/g, ' ').slice(0, 700) });
  expect(dash, 'панель отвечает и показывает выработку').toMatch(/Сваи|Бурение|Простой|Отчёт/i);

  await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const an = await dump(page, 'everywhere-08-аналитика');
  record({
    step: 'аналитика',
    Краснов: /Краснов/.test(an),
    Иванов: /Иванов/.test(an),
    Щеголев: /Щеголев/.test(an),
    фрагмент: an.replace(/\s+/g, ' ').slice(0, 700),
  });
  expect(an, 'аналитика содержит операторов дня').toMatch(/Краснов|Иванов|Щеголев/);

  // Карточка установки КБУРГ-16.02 №1: последний отчёт сегодня + техготовность
  const kburg = db(`SELECT id FROM "Equipment" WHERE name ILIKE 'КБУРГ-16.02 №1%' ORDER BY "createdAt" LIMIT 1`);
  await page.goto(`/admin/equipment/${kburg}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const card = await dump(page, 'everywhere-09-кбург-карточка');
  record({ step: 'карточка КБУРГ №1', фрагмент: card.replace(/\s+/g, ' ').slice(0, 800) });

  await page.goto('/admin/to', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const to = await dump(page, 'everywhere-10-то');
  record({ step: 'техготовность и ТО', фрагмент: to.replace(/\s+/g, ' ').slice(0, 600) });
});
