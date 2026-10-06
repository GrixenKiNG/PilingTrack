/**
 * Задание №12 (06.10.2026): живой обход бригад операторов через Playwright.
 *
 *  • полные смены по версиям matrix.json (кроме исключений владельца);
 *  • подтверждение известных дефектов отдельными тестами (test.fail + номер):
 *    NEW-9 (v1), D-20260930-001 (v2), D-20261001-001 (v5), D-20260930-003 (помощники);
 *  • данные и снимки — docs/qa-autoclaw/walk-1006/ (png не коммитятся).
 *
 * Обход возобновляемый: каждый шаг выполняется, только если в базе/на экране
 * ещё нет его результата (лимит входов и обрывы не должны ломать прогон).
 *
 * Запуск: npx playwright test -c playwright.acqa.config.ts operator-walk.spec.ts
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
  console.log('[record]', JSON.stringify(entry).slice(0, 400));
}

function hm(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow' }).format(d);
}

async function strip(page: Page) {
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove()));
}

async function tap(page: Page, target: Locator, note = '') {
  await strip(page);
  try {
    await target.click({ timeout: 12_000 });
  } catch {
    await strip(page);
    await target.click({ force: true, timeout: 12_000 });
  }
  await page.waitForTimeout(500);
  if (note) console.log('[tap]', note);
}

async function dump(page: Page, name: string): Promise<string> {
  const txt = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(LOGS, `${name}.txt`), txt, 'utf8');
  await page.screenshot({ path: path.join(WALK, `${name}.png`), fullPage: false }).catch(() => undefined);
  console.log(`[dump ${name}]`, txt.replace(/\s+/g, ' ').slice(0, 220));
  return txt;
}

/** Ответы API страницы для доказательств (код и тело). */
function apiWatch(page: Page): string[] {
  const log: string[] = [];
  page.on('response', (r) => {
    const u = r.url();
    if (!u.includes('/api/') || !u.startsWith('http://localhost:3000')) return;
    void r.text().then((body) => log.push(`${r.status()} ${r.request().method()} ${u.replace('http://localhost:3000', '')} :: ${body.replace(/\s+/g, ' ').slice(0, 260)}`)).catch(() => undefined);
  });
  return log;
}

/** Чек-лист (общий экран screens/checklist-screen): массовые отметки + пункты + завершение. */
async function completeChecklist(page: Page) {
  await page.waitForTimeout(1500);
  for (let guard = 0; guard < 12; guard++) {
    const bulk = page.locator('button[aria-label*="в норме"]:not([disabled])');
    const n = await bulk.count();
    let progressed = false;
    for (let j = 0; j < n; j++) {
      if ((await bulk.nth(j).getAttribute('aria-pressed')) !== 'true') {
        await tap(page, bulk.nth(j), `массовая отметка #${j}`);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  for (let guard = 0; guard < 10; guard++) {
    const expanders = page.locator('button[aria-expanded]');
    const n = await expanders.count();
    let target: Locator | null = null;
    for (let j = 0; j < n; j++) {
      const txt = (await expanders.nth(j).innerText().catch(() => '')).replace(/\s+/g, ' ');
      const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
      if (m && Number(m[1]) < Number(m[2])) { target = expanders.nth(j); break; }
    }
    if (!target) break;
    await tap(page, target, 'раскрыть раздел');
    const nrm = page.getByRole('button', { name: /^Норма$/ });
    const kn = await nrm.count();
    for (let k = 0; k < kn; k++) await tap(page, nrm.nth(k), `Норма #${k}`);
    const measures = page.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    const nm = await measures.count();
    for (let k = 0; k < nm; k++) {
      if (await measures.nth(k).inputValue()) continue;
      const label = await measures.nth(k).evaluate((el) => (el.closest('label')?.innerText ?? '')).catch(() => '');
      const value = /%/.test(label) ? '50' : /моточас|м\/ч/.test(label) ? '99999' : '10';
      await measures.nth(k).fill(value);
    }
    await page.waitForTimeout(400);
  }
  const finish = page.getByRole('button', { name: /^Завершить$/ });
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await tap(page, finish, 'Завершить чек-лист');
  await page.waitForTimeout(2500);
}

/** Идентификатор сегодняшней смены бригады (для возобновляемости и сверок). */
function shiftIdOf(email: string, date = '2026-10-06'): string {
  return db(`SELECT id FROM "Shift" WHERE "createdById"=(SELECT id FROM "User" WHERE email='${email}') AND "productionDate"='${date}' ORDER BY "createdAt" DESC LIMIT 1`);
}

test('v7 (Banut 655, r0mix0n): полная смена — допуск, осмотры, 2 сваи, бурение, простой, отчёт', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const apis = apiWatch(page);
  await login(page, 'r0mix0n@mail.ru');
  await page.goto('/operator/v7', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await dump(page, 'v7-01-старт');

  // Допуск: СИЗ (если ещё не пройден)
  const ppe = page.locator('button.row').filter({ hasText: /СИЗ/ });
  if (await ppe.count()) {
    await tap(page, ppe.first(), 'СИЗ');
    await page.waitForTimeout(1500);
    const confirm = page.getByRole('button', { name: /Комплект в порядке|Подтвердить/ });
    if (await confirm.count()) { await tap(page, confirm.first(), 'комплект в порядке'); await page.waitForTimeout(2200); }
  }

  // Приём установки (если смены ещё нет)
  if (!shiftIdOf('r0mix0n@mail.ru')) {
    const accept = page.getByRole('button', { name: /Принять установку/ });
    if (await accept.count()) {
      await tap(page, accept.first(), 'открыть приём');
      await page.waitForTimeout(1200);
      const day = page.getByRole('button', { name: 'Дневная' });
      if (await day.count()) await tap(page, day.first(), 'Дневная');
      await tap(page, page.getByRole('button', { name: /Принять установку/ }).first(), 'принять установку');
      await page.waitForTimeout(3200);
    }
  }
  await dump(page, 'v7-02-после-сиз-приёма');

  // Оставшиеся осмотры (их три: предсменный, площадка, пуск)
  for (let stage = 0; stage < 3; stage++) {
    const open = page.getByRole('button', { name: /Пройти чек-лист|Открыть чек-лист/ });
    if (!(await open.count())) break;
    await tap(page, open.first(), `чек-лист ${stage + 1}`);
    await completeChecklist(page);
    await dump(page, `v7-03-осмотр-${stage + 1}`);
  }

  const shiftId = shiftIdOf('r0mix0n@mail.ru');
  expect(shiftId, 'смена 06.10 создана').not.toBe('');

  // Сваи (2 шт) — если ещё не записаны
  const pilesDone = Number(db(`SELECT COALESCE(SUM(count),0) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND "pileGradeId" IS NOT NULL`));
  if (pilesDone < 2) {
    await tap(page, page.getByRole('button', { name: /Добавить сваю/ }).first(), 'добавить сваю');
    await page.waitForTimeout(1000);
    await tap(page, page.locator('.picks button').first(), 'марка (первая)');
    await page.locator('input[type="number"]').first().fill('2');
    await page.locator('input[type="text"]').last().fill('AC-QA walk-1006 две сваи');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать сваи');
    await page.waitForTimeout(2200);
  }
  await dump(page, 'v7-04-сваи');

  // Бурение (1 скв · 12 м) — записи бурения живут в LeaderDrilling, не в PileWork
  const drillDone = Number(db(`SELECT COUNT(*) FROM "LeaderDrilling" WHERE "shiftId"='${shiftId}'`));
  if (drillDone < 1) {
    await tap(page, page.getByRole('button', { name: /Добавить бурение/ }).first(), 'добавить бурение');
    await page.waitForTimeout(1000);
    await tap(page, page.locator('.picks button').first(), 'тип бурения (первый)');
    const nums = page.locator('input[type="number"]');
    await nums.nth(0).fill('1');
    await nums.nth(1).fill('12');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать бурение');
    await page.waitForTimeout(2200);
  }
  await dump(page, 'v7-05-бурение');

  // Простой (причина + интервал внутри смены)
  const dtCount = Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`));
  if (dtCount === 0) {
    await tap(page, page.getByRole('button', { name: /^Простой$/ }).first(), 'простой');
    await page.waitForTimeout(1000);
    await tap(page, page.locator('.picks button').first(), 'причина (первая)');
    const shiftStart = new Date(db(`SELECT "startedAt" FROM "Shift" WHERE id='${shiftId}'`));
    const startedAt = new Date(Math.max(shiftStart.getTime() + 60_000, Date.now() - 10 * 60_000));
    await page.getByLabel('Простой начался').fill(hm(startedAt));
    await tap(page, page.getByRole('button', { name: /Закончился сейчас/ }), 'закончился сейчас');
    await page.getByLabel('Примечание (необязательно)').fill('AC-QA walk-1006 простой');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать простой');
    await page.waitForTimeout(2500);
    const dtAfter = Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`));
    record({ step: 'v7-простой', dtBefore: dtCount, dtAfter, интервалНачало: hm(startedAt) });
    expect(dtAfter, 'простой записан').toBe(1);
  }
  await dump(page, 'v7-06-простой');

  // Завершение работы → сдача
  if (await page.locator('button.oc-finish').count()) {
    await tap(page, page.locator('button.oc-finish').first(), 'Завершить работу');
    await page.waitForTimeout(3500);
  }
  await dump(page, 'v7-07-сдача');

  // ЕО после работы: на экране сдачи — «Послесменное обслуживание»; в детуре — «Выполнить ЕО…»
  const eoHome = page.getByRole('button', { name: 'Послесменное обслуживание' });
  if (await eoHome.count()) {
    await tap(page, eoHome.first(), 'Послесменное обслуживание');
    await page.waitForTimeout(2000);
    await completeChecklist(page);
    await dump(page, 'v7-08-ео-сдано');
  }
  const close = page.getByRole('button', { name: /^Закрыть смену$/ });
  if (await close.count()) { await tap(page, close.first(), 'открыть закрытие'); await page.waitForTimeout(2000); }
  await dump(page, 'v7-09-закрытие');
  const eoDetour = page.getByRole('button', { name: /Выполнить ЕО/ });
  if (await eoDetour.count()) {
    await tap(page, eoDetour.first(), 'ЕО из детура');
    await page.waitForTimeout(2000);
    await completeChecklist(page);
    await dump(page, 'v7-08b-ео-сдано');
  }
  const closeFinal = page.getByRole('button', { name: /^Закрыть смену$/ });
  if (await closeFinal.count()) {
    await expect(closeFinal).toBeEnabled({ timeout: 15_000 }).catch(() => undefined);
    await tap(page, closeFinal.first(), 'финальное закрытие');
    await page.waitForTimeout(6000);
  }
  const closedText = await dump(page, 'v7-10-закрыта');

  const shiftState = db(`SELECT state FROM "Shift" WHERE id='${shiftId}'`);
  const reportRow = db(`SELECT "reportId", status, "submittedAt" FROM "Report" WHERE "shiftId"='${shiftId}'`);
  const piles = db(`SELECT COALESCE(SUM(count),0) || '|' || COALESCE(SUM(count*14),0) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND "pileGradeId" IS NOT NULL`);
  const drilling = db(`SELECT COALESCE(SUM(count),0) || '|' || COALESCE(SUM(meters),0) FROM "LeaderDrilling" WHERE "shiftId"='${shiftId}'`);
  const downtimeRow = db(`SELECT "durationSeconds" FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`);
  record({ step: 'v7-итог', shiftId, shiftState, reportRow, piles, drilling, downtime: downtimeRow || '(нет)', apis: apis.slice(-10) });

  const [reportId, reportStatus, submittedAt] = reportRow.split('|');
  expect(reportStatus, 'отчёт сдан').toBe('submitted');
  expect(shiftState).toBe('CLOSED');
  expect(closedText).toContain('RM-');
  record({ step: 'v7-отчёт-для-таблицы', reportId, submittedAt, piles: piles.split('|')[0] + ' шт / ' + piles.split('|')[1] + ' м.п.', drilling, downtime: downtimeRow });
});

test('v1 (КБУРГ-16.02 №1, ka@): завершение и сдача смены — NEW-9 не воспроизводится', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const apis = apiWatch(page);
  await login(page, 'ka@piling.ru');
  await page.goto('/operator', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await dump(page, 'ka-01-состояние');

  // Если смена ещё на шаге «Работа» — завершаем её чистым кликом (проверка NEW-9)
  if (await page.locator('button.oc-finish').count()) {
    await tap(page, page.locator('button.oc-finish').first(), 'Завершить работу');
    const confirm = page.getByRole('button', { name: /Да, работа завершена/ });
    if (await confirm.count()) await tap(page, confirm.first(), 'Да, работа завершена');
    await page.waitForTimeout(4000);
  }
  const t2 = await dump(page, 'ka-02-после-завершения');
  const ужеЗакрыта = /Смена закрыта|Отчёт отправлен/i.test(t2);
  const step7 = /ШАГ 7|Сдача/.test(t2) || ужеЗакрыта;
  record({ step: 'NEW-9', шаг7: step7, ужеЗакрыта, хвост: t2.replace(/\s+/g, ' ').slice(-320), apis: apis.slice(-14) });
  expect(step7, 'NEW-9 не воспроизводится: чистый клик переводит на шаг 7 «Сдача»').toBe(true);

  // ЕО после работы
  const eo = page.getByRole('button', { name: /Выполнить ЕО после работы/ });
  if (await eo.count()) {
    await tap(page, eo.first(), 'ЕО после работы');
    await page.waitForTimeout(2000);
    await completeChecklist(page);
    await dump(page, 'ka-03-ео-сдано');
  }

  // Закрытие смены
  const close = page.getByRole('button', { name: /Закрыть смену и отправить отчёт/ });
  if (await close.count()) {
    await expect(close.first()).toBeEnabled({ timeout: 15_000 }).catch(() => undefined);
    await tap(page, close.first(), 'закрыть смену и отправить отчёт');
    await page.waitForTimeout(3000);
    await dump(page, 'ka-04a-подтверждение');
    const confirmClose = page.getByRole('button', { name: /Да, закрыть|Подтвердить/ });
    if (await confirmClose.count()) {
      await tap(page, confirmClose.first(), 'подтвердить');
      await page.waitForTimeout(6000);
    }
  }
  const t3 = await dump(page, 'ka-05-закрыта');

  const shiftRow = db(`SELECT id || '|' || state FROM "Shift" WHERE "createdById"=(SELECT id FROM "User" WHERE email='ka@piling.ru') ORDER BY "createdAt" DESC LIMIT 1`);
  const [kaShiftId, kaState] = shiftRow.split('|');
  const reportRow = db(`SELECT "reportId" || '|' || status || '|' || COALESCE("submittedAt"::text,'') FROM "Report" WHERE "shiftId"='${kaShiftId}'`);
  record({ step: 'ka-итог', kaShiftId, kaState, reportRow });
  expect(reportRow.includes('submitted'), 'отчёт смены ka@ сдан').toBe(true);
  expect(kaState).toBe('CLOSED');
  expect(t3).toMatch(/RM-/);
});

test('D-20260930-001: v2 (apj@piling.ru) — после HANDOVER_PENDING открывается новый цикл', async ({ page }) => {
  test.fail(true, 'D-20260930-001: смена зависла в HANDOVER_PENDING с 27.09, новый цикл не начинается');
  const apis = apiWatch(page);
  await login(page, 'apj@piling.ru');
  await page.goto('/operator/v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const before = await dump(page, 'apj-01-состояние');
  const home = page.getByRole('button', { name: /На главную/ });
  if (await home.count()) { await tap(page, home.first(), 'На главную'); await page.waitForTimeout(3500); }
  const after = await dump(page, 'apj-02-после-главной');
  record({ step: 'D-20260930-001', before: before.replace(/\s+/g, ' ').slice(0, 300), after: after.replace(/\s+/g, ' ').slice(0, 300), apis: apis.slice(-8) });
  expect(after, 'новый цикл смены (допуск, приём или осмотр)').toMatch(/Допуск|Принять установку|Приём|осмотр/i);
});

test('D-20261001-001: v5 (mag@piling.ru) — баннер о незакрытой смене 30.09 и новая смена', async ({ page }) => {
  test.fail(true, 'D-20261001-001: v5 продолжает смену 30.09, выработка уходит в отчёт вчерашней даты');
  const apis = apiWatch(page);
  await login(page, 'mag@piling.ru');
  await page.goto('/operator/v5', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const before = await dump(page, 'mag-01-состояние');
  // Пробуем двигаться: сегодняшняя проверка СИЗ, затем смотрим, за какую смену экран
  const ppe = page.getByRole('button', { name: /Проверить средства защиты/ });
  if (await ppe.count()) {
    await tap(page, ppe.first(), 'проверить СИЗ');
    await page.waitForTimeout(2500);
    await dump(page, 'mag-02-сиз');
    const finishPpe = page.getByRole('button', { name: /Комплект в порядке|Подтвердить|Продолжить/ });
    if (await finishPpe.count()) {
      await tap(page, finishPpe.first(), 'СИЗ ок');
      await page.waitForTimeout(3000);
      await dump(page, 'mag-03-после-сиз');
    }
  }
  const after = await dump(page, 'mag-04-дальше');
  record({ step: 'D-20261001-001', before: before.replace(/\s+/g, ' ').slice(0, 300), after: after.replace(/\s+/g, ' ').slice(0, 400), apis: apis.slice(-10) });
  expect(before + ' ' + after, 'баннер о незакрытой смене 30.09 (или её закрытие)').toMatch(/незакрыт|закрыть|передать|30\.09/i);
});

test('v1 (Bauer RTG RM20, operator@): полная смена от допуска до отчёта', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const apis = apiWatch(page);
  await login(page, 'operator@piling.ru');
  await page.goto('/operator', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await dump(page, 'operator-01-старт');

  // Допуск: СИЗ
  const ppe = page.getByRole('button', { name: /Проверить средства защиты/ });
  if (await ppe.count()) {
    await tap(page, ppe.first(), 'проверить СИЗ');
    await page.waitForTimeout(2200);
    await dump(page, 'operator-02-сиз');
    const confirm = page.getByRole('button', { name: /Комплект в порядке|Подтвердить/ });
    if (await confirm.count()) { await tap(page, confirm.first(), 'СИЗ ок'); await page.waitForTimeout(3000); }
  }
  await dump(page, 'operator-03-после-сиз');

  // Приём установки
  const accept = page.getByRole('button', { name: /Принять и открыть смену|Принять установку/ });
  if (await accept.count()) { await tap(page, accept.first(), 'принять установку'); await page.waitForTimeout(3500); }
  await dump(page, 'operator-04-приём');

  // Осмотры: на v1 чек-лист открывается сам после приёма; на всякий случай — и кнопкой
  for (let i = 0; i < 3; i++) {
    const open = page.getByRole('button', { name: /Пройти чек-лист|Открыть чек-лист|Пройти осмотр|Начать осмотр|Осмотреть/ });
    if (await open.count()) {
      await tap(page, open.first(), 'чек-лист ' + (i + 1));
      await page.waitForTimeout(2200);
    }
    const onChecklist = (await page.locator('button[aria-label*="в норме"]').count()) > 0;
    if (!onChecklist) break;
    await completeChecklist(page);
    await dump(page, 'operator-05-осмотр-' + (i + 1));
    await page.waitForTimeout(1500);
  }

  // Работа v1: каждая запись — своя кнопка с главной; форма закрывается после записи
  const shiftId = db(`SELECT id FROM "Shift" WHERE "createdById"=(SELECT id FROM "User" WHERE email='operator@piling.ru') AND "productionDate"='2026-10-06' ORDER BY "createdAt" DESC LIMIT 1`);
  expect(shiftId, 'смена operator@ создана').not.toBe('');
  const pilesDone = Number(db(`SELECT COALESCE(SUM(count),0) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND "pileGradeId" IS NOT NULL`));
  const drillDone = Number(db(`SELECT COUNT(*) FROM "LeaderDrilling" WHERE "shiftId"='${shiftId}'`));
  const dtCount = Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`));
  if (pilesDone < 2) {
    if (!(await page.getByLabel('Марка сваи').count())) {
      await tap(page, page.getByRole('button', { name: /Добавить сваю/ }).first(), 'открыть форму свай');
      await page.waitForTimeout(1500);
    }
    await dump(page, 'operator-06-форма-сваи');
    await page.getByLabel('Марка сваи').selectOption({ index: 1 });
    await page.getByLabel('Свай, шт').fill('2');
    await page.getByLabel('Комментарий').fill('AC-QA walk-1006 две сваи');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать сваи');
    await page.waitForTimeout(2800);
  }
  await dump(page, 'operator-07-сваи');
  if (drillDone < 1) {
    await tap(page, page.getByRole('button', { name: /Добавить бурение/ }).first(), 'открыть бурение');
    await page.waitForTimeout(1500);
    await dump(page, 'operator-08-форма-бурения');
    await page.getByLabel('Тип бурения').selectOption({ index: 1 });
    await page.getByLabel('Скважин, шт').fill('1');
    await page.getByLabel('Метров на одну скважину').fill('12');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать бурение');
    await page.waitForTimeout(2800);
  }
  await dump(page, 'operator-09-бурение');
  if (dtCount === 0) {
    await tap(page, page.getByRole('button', { name: /^Простой$/ }).first(), 'открыть простой');
    await page.waitForTimeout(1500);
    await dump(page, 'operator-10-форма-простоя');
    await page.getByLabel('Причина простоя').selectOption({ index: 1 });
    const shiftStart = new Date(db(`SELECT "startedAt" FROM "Shift" WHERE id='${shiftId}'`));
    const startedAt = new Date(Math.max(shiftStart.getTime() + 60_000, Date.now() - 10 * 60_000));
    await page.getByLabel('Простой начался').fill(hm(startedAt));
    await page.getByLabel('Закончился').fill(hm(new Date()));
    await page.getByLabel('Комментарий').fill('AC-QA walk-1006 простой');
    await tap(page, page.getByRole('button', { name: /^Записать$/ }), 'записать простой');
    await page.waitForTimeout(2800);
  }
  await dump(page, 'operator-11-простой');

  // Завершение и отправка отчёта
  if (await page.locator('button.oc-finish:visible').count()) {
    await tap(page, page.locator('button.oc-finish:visible').first(), 'Завершить работу');
    const confirm = page.getByRole('button', { name: /Да, работа завершена/ });
    if (await confirm.count()) await tap(page, confirm.first(), 'Да, работа завершена');
    await page.waitForTimeout(4000);
  }
  await dump(page, 'operator-12-сдача');
  const eo = page.getByRole('button', { name: /Выполнить ЕО после работы/ });
  if (await eo.count()) {
    await tap(page, eo.first(), 'ЕО после работы');
    await page.waitForTimeout(2000);
    await completeChecklist(page);
    await dump(page, 'operator-13-ео');
  }
  const close = page.getByRole('button', { name: /Закрыть смену и отправить отчёт/ });
  if (await close.count()) { await tap(page, close.first(), 'закрыть смену'); await page.waitForTimeout(3500); }
  const confirmClose = page.getByRole('button', { name: /Да, закрыть|Подтвердить/ });
  if (await confirmClose.count()) { await tap(page, confirmClose.first(), 'подтвердить'); await page.waitForTimeout(6000); }
  const final = await dump(page, 'operator-14-закрыта');

  const state = db(`SELECT state FROM "Shift" WHERE id='${shiftId}'`);
  const reportRow = db(`SELECT "reportId" || '|' || status || '|' || COALESCE("submittedAt"::text,'') FROM "Report" WHERE "shiftId"='${shiftId}'`);
  const piles = db(`SELECT COALESCE(SUM(count),0)::text FROM "PileWork" WHERE "shiftId"='${shiftId}' AND "pileGradeId" IS NOT NULL`);
  const drilling = db(`SELECT COALESCE(SUM(meters),0)::text FROM "LeaderDrilling" WHERE "shiftId"='${shiftId}'`);
  const downtimeRow = db(`SELECT "durationSeconds"::text FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`);
  record({ step: 'operator-итог', shiftId, state, reportRow, piles, drilling, downtime: downtimeRow, apis: apis.slice(-10) });
  expect(reportRow.includes('submitted'), 'отчёт сдан').toBe(true);
  expect(state).toBe('CLOSED');
  expect(final).toMatch(/RM-/);
});

test('v10 (Woltman-PVE 50PR, ivv@): продолжает смену 04.10 под видом 06.10 (D-20261001-001)', async ({ page }) => {
  test.fail(true, 'D-20261001-001 (v10): после сегодняшнего допуска v10 продолжает старую смену 04.10, записи уходят в вчерашний отчёт');
  test.setTimeout(10 * 60_000);
  const apis = apiWatch(page);
  await login(page, 'ivv@piling.ru');
  await page.goto('/operator/v10', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const t1 = await dump(page, 'ivv-01-дом');
  const next = page.locator('button.ov10-btn');
  if (await next.count()) { await tap(page, next.first(), 'Дальше'); await page.waitForTimeout(2500); }
  const t2 = await dump(page, 'ivv-02-работа');
  const показываетСегодня = /06\.10\.2026/.test(t2);
  const старыеДанные = /2 шт\. · 20 м/.test(t2);
  record({ step: 'D-20261001-001 (v10): состояние', показываетСегодня, старыеДанные, хвост: t2.replace(/\s+/g, ' ').slice(0, 400), apis: apis.slice(-10) });

  // Пробная запись: проверяем, в какую смену уходит выработка
  const OLD_SHIFT = '95cd98f5-989d-42eb-89cf-193ed993ad31';
  const before = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${OLD_SHIFT}'`));
  const pileBtn = page.getByRole('button', { name: /^Свая$/ });
  if (await pileBtn.count()) {
    await tap(page, pileBtn.first(), 'Свая (открыть форму)');
    await page.waitForTimeout(1800);
    await dump(page, 'ivv-03-форма-сваи');
    const grade = page.getByLabel('Марка сваи');
    if (await grade.count()) await grade.selectOption({ index: 1 });
    const amount = page.getByLabel('Количество, шт');
    if (await amount.count()) await amount.fill('1');
    const save = page.getByRole('button', { name: /Записать/ }).first();
    if (await save.count()) { await tap(page, save, 'записать сваю (проба)'); await page.waitForTimeout(3000); }
    await dump(page, 'ivv-04-после-пробы');
  }
  const after = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${OLD_SHIFT}'`));
  const ушлаВСтарую = after > before;
  record({ step: 'D-20261001-001 (v10): привязка записи', before, after, ушлаВСтарую, apis: apis.filter((a) => /command/.test(a)).slice(-6) });

  // Ожидалось: баннер «есть незакрытая смена за 04.10» с действием и работа в НОВОЙ смене 06.10.
  // Получилось: баннера нет, а пробная запись ушла в смену 04.10 (95cd98f5).
  const естьБаннер = /незакрыт|передать смену|смена за 04\.10/i.test(t1 + ' ' + t2);
  expect(естьБаннер, 'ОЖИДАЛОСЬ: баннер про незакрытую смену 04.10 и новая смена за 06.10').toBe(true);
  expect(ушлаВСтарую, 'выработка не должна уходить в старую смену 04.10').toBe(false);
});

test('D-20260930-001: v2 (gea@piling.ru) — вторая бригада того же дефекта', async ({ page }) => {
  test.fail(true, 'D-20260930-001: смена зависла в HANDOVER_PENDING с 27.09 (бригада КБУРГ-16.02 №2)');
  const apis = apiWatch(page);
  await login(page, 'gea@piling.ru');
  await page.goto('/operator/v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const before = await dump(page, 'gea-01-состояние');
  const home = page.getByRole('button', { name: /На главную/ });
  if (await home.count()) { await tap(page, home.first(), 'На главную'); await page.waitForTimeout(3500); }
  const after = await dump(page, 'gea-02-после-главной');
  record({ step: 'D-20260930-001 (gea)', before: before.replace(/\s+/g, ' ').slice(0, 300), after: after.replace(/\s+/g, ' ').slice(0, 300), apis: apis.slice(-8) });
  expect(after, 'новый цикл смены (допуск, приём или осмотр)').toMatch(/Допуск|Принять установку|Приём|осмотр/i);
});

test('D-20260930-003: помощник v5 (kn@) — «экран доступен только машинисту» (не воспроизводится)', async ({ page }) => {
  const apis = apiWatch(page);
  await login(page, 'kn@piling.ru');
  await page.goto('/operator/v5', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const txt = await dump(page, 'asst-kn-v5');
  record({ step: 'D-20260930-003 (v5)', текст: txt.replace(/\s+/g, ' ').slice(0, 400), apis: apis.slice(-6) });
  expect(txt, 'объяснение про машиниста').toMatch(/доступен только машинисту|ведёт машинист/i);
});

test('D-20260930-003: помощник v7 (qa-hermes-assistant-2) — объяснение про машиниста (не воспроизводится)', async ({ page }) => {
  const apis = apiWatch(page);
  await login(page, 'qa-hermes-assistant-2@piling.test');
  await page.goto('/operator/v7', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const txt = await dump(page, 'asst-2-v7');
  record({ step: 'D-20260930-003 (v7)', текст: txt.replace(/\s+/g, ' ').slice(0, 400), apis: apis.slice(-6) });
  expect(txt, 'объяснение про машиниста').toMatch(/доступен только машинисту|ведёт машинист/i);
});

test('помощники прочих версий: что видно на экране бригады (сбор доказательств)', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const partners: [string, string][] = [
    ['helper@piling.ru', '/operator'],
    ['qa-hermes-assistant-3@piling.test', '/operator'],
    ['tr@piling.ru', '/operator/v2'],
    ['qa-hermes-assistant-4@piling.test', '/operator/v2'],
    ['qa-hermes-assistant-1@piling.test', '/operator/v10'],
  ];
  for (const [email, path] of partners) {
    await login(page, email);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const txt = await dump(page, `asst-${email.split('@')[0]}-${path.replace(/\//g, '_')}`);
    record({ step: 'помощники', email, path, экран: txt.replace(/\s+/g, ' ').slice(0, 260) });
  }
});
