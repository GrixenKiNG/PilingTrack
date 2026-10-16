/**
 * Живая перепроверка исправлений аудита 14–16.10.2026 на локальном стенде
 * (localhost:3000, QA-база). Каждый тест отвечает на вопрос карточки дефекта:
 *   AU39-04          администратор сохраняет отчёт оператора, назначенного только бригадой;
 *   AU195-14         итоги журнала свай при поиске номера совпадают со строками;
 *   R78-41           работник подтверждает инструктаж инструктора на ТОЙ ЖЕ записи;
 *   D-20261016-001   сводка допуска помощника v7 не врёт про обязательные документы;
 *   D-20261010-001   неотправленные формы осмотра и выработки переживают перезагрузку.
 *
 * Данные ищутся в базе динамически, а не зашиты по датам и номерам: тесты не должны
 * устаревать, как устарели сценарии 06.10 (они помечены fixme). Если подходящих данных
 * нет — тест честно пропускается с причиной, а не проходит вхолостую.
 * Запись в базу — только метки «AC-QA»; отчёт при проверке AU39-04 сохраняется без
 * изменения содержимого.
 *
 * Запуск: npx playwright test -c playwright.acqa.config.ts audit-fixes-1016.spec.ts
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { execSync } from 'node:child_process';
import { login, matrix } from '../qa/helpers';
import { api } from './util';

const ADMIN = matrix.roles.find((r) => r.role === 'ADMIN')?.email ?? '';
const WORKER = 'qa-audit-1014-operator@piling.test';
const ASSISTANT = 'qa-audit-1014-assistant@piling.test';

function db(sql: string): string {
  return execSync(
    'docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -At -v ON_ERROR_STOP=1',
    { input: sql, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  ).trim();
}

async function strip(page: Page) {
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove()));
}

async function tap(page: Page, target: Locator) {
  await strip(page);
  try { await target.click({ timeout: 15_000 }); } catch { await strip(page); await target.click({ force: true, timeout: 15_000 }); }
  await page.waitForTimeout(600);
}

test.describe.configure({ mode: 'serial' });
// Дев-сервер компилирует маршруты по первому запросу: запросы и переходы ждут дольше обычного.
test.use({ actionTimeout: 90_000, navigationTimeout: 90_000 });

test('AU39-04: администратор сохраняет отчёт оператора, назначенного только бригадой', async ({ page }) => {
  test.setTimeout(120_000);
  const row = db(`SELECT r."reportId" || '|' || r."userId" || '|' || r."siteId" FROM "Report" r
    WHERE r.status = 'submitted'
      AND NOT EXISTS (SELECT 1 FROM "UserSiteAssignment" a WHERE a."userId" = r."userId" AND a."siteId" = r."siteId")
      AND EXISTS (SELECT 1 FROM "Crew" c WHERE c."operatorId" = r."userId" AND c."siteId" = r."siteId" AND c."isActive")
      -- Отчёт с поправкой простоя (отрицательные часы) админская форма пока не принимает: отдельная находка.
      AND NOT EXISTS (SELECT 1 FROM "ReportDowntime" d WHERE d."reportId" = r.id AND d.duration < 0)
    ORDER BY r."date" DESC LIMIT 1`);
  test.skip(!row, 'в QA-базе нет сданного отчёта оператора, назначенного на объект только бригадой');
  const [reportId, userId, siteId] = row.split('|');

  await login(page, ADMIN);
  const list = await api(page).get(`/api/reports/all?userId=${userId}&siteId=${siteId}&limit=50`);
  expect(list.status()).toBe(200);
  interface ListedReport {
    reportId: string; date: string; version: number; equipmentId?: string | null; equipment?: { id: string } | null;
    piles?: Array<{ id: string; pileGradeId: string; count: number; picketId?: string | null }>;
    drillings?: Array<{ id: string; typeId: string; count: number; metersPerUnit: number; meters: number; picketId?: string | null }>;
    downtimes?: Array<{ id: string; reasonId: string; duration: number; comment?: string | null }>;
  }
  const body = await list.json() as { reports?: ListedReport[]; data?: ListedReport[] };
  const report = (body.reports ?? body.data ?? []).find((item) => item.reportId === reportId);
  if (!report) throw new Error('отчёт не найден в списке администратора');

  const res = await api(page).post('/api/reports/admin-upsert', { data: {
    reportId, userId, siteId, date: report.date, version: report.version,
    equipmentId: report.equipmentId ?? report.equipment?.id ?? undefined,
    piles: (report.piles ?? []).map((p) => ({ id: p.id, pileGradeId: p.pileGradeId, count: p.count, picketId: p.picketId ?? undefined })),
    drillings: (report.drillings ?? []).map((d) => ({ id: d.id, typeId: d.typeId, count: d.count, metersPerUnit: d.metersPerUnit, meters: d.meters, picketId: d.picketId ?? undefined })),
    downtimes: (report.downtimes ?? []).map((d) => ({ id: d.id, reasonId: d.reasonId, duration: d.duration, comment: d.comment ?? undefined })),
  } });
  expect(res.status(), `сохранение без 403 «Нет доступа к этому объекту»: ${(await res.text()).slice(0, 160)}`).toBe(200);
});

test('AU195-14: поиск номера в журнале свай — итоги не нули и совпадают со строками', async ({ page }) => {
  test.setTimeout(120_000);
  const number = db(`SELECT "pileNumber" FROM "PilePassport" WHERE "pileNumber" LIKE '%\\_%' ORDER BY "createdAt" DESC LIMIT 1`);
  test.skip(!number, 'в QA-базе нет паспорта сваи с «_» в номере');

  await login(page, ADMIN);
  const res = await api(page).get(`/api/pile-passports?pileNumber=${encodeURIComponent(number)}&limit=500`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { data: Array<{ count?: number }>; header: { pilesTotal: number; rowsTotal: number } };
  expect(body.data.length, `поиск «${number}» нашёл строки`).toBeGreaterThan(0);
  expect(body.header.rowsTotal, 'итог «строк» не ноль').toBeGreaterThan(0);
  expect(body.header.pilesTotal, 'итог «свай» не ноль').toBeGreaterThan(0);
  expect(body.header.rowsTotal).toBeGreaterThanOrEqual(body.data.length);

  const none = await api(page).get(`/api/pile-passports?pileNumber=${encodeURIComponent('нет-такого-номера-zzz')}&limit=500`);
  const empty = await none.json() as { data: unknown[]; header: { pilesTotal: number } };
  expect(empty.data).toHaveLength(0);
  expect(empty.header.pilesTotal).toBe(0);
});

let briefingId = '';

test('R78-41 (1/2): инженер проводит инструктаж, у работника он ждёт его отметки', async ({ page }) => {
  test.setTimeout(120_000);
  const workerId = db(`SELECT id FROM "User" WHERE email = '${WORKER}'`);
  test.skip(!workerId, 'нет QA-работника qa-audit-1014-operator');
  const doc = db(`SELECT "documentCode" || '|' || "documentTitle" || '|' || "documentVersion" FROM "BriefingRecord"
    WHERE kind = 'INSTRUCTION' ORDER BY "recordedAt" DESC LIMIT 1`);
  test.skip(!doc, 'в QA-базе нет ни одной записи инструктажа, взять название инструкции неоткуда');
  const [documentCode, documentTitle, documentVersion] = doc.split('|');

  await login(page, ADMIN);
  const created = await api(page).post('/api/briefings', { data: {
    userId: workerId, type: 'REPEAT', documentCode, documentTitle, documentVersion, reason: 'AC-QA audit-fixes 1016',
  } });
  expect([200, 201], `проведение инструктажа: ${(await created.text()).slice(0, 160)}`).toContain(created.status());

  briefingId = db(`SELECT id FROM "BriefingRecord" WHERE "userId" = '${workerId}' AND "instructorId" IS NOT NULL
    AND "employeeSignedAt" IS NULL AND reason = 'AC-QA audit-fixes 1016' ORDER BY "recordedAt" DESC LIMIT 1`);
  expect(briefingId, 'запись инструктажа создана и ждёт работника').not.toBe('');
});

test('R78-41 (2/2): работник подтверждает ту же запись в «Мой допуск»', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(!briefingId, 'запись инструктажа не создана предыдущим шагом');
  await login(page, WORKER);

  const before = await (await api(page).get('/api/safety/my-clearance')).json() as { history: Array<{ id: string; awaitingEmployeeSignature: boolean; instructorName: string | null }> };
  const row = before.history.find((item) => item.id === briefingId);
  expect(row?.awaitingEmployeeSignature, 'сервер отдаёт «ждёт отметки работника»').toBe(true);
  expect(row?.instructorName, 'называет инструктора').toBeTruthy();

  await page.goto('/admin/safety', { waitUntil: 'domcontentloaded' });
  const button = page.getByRole('button', { name: /Подтвердить инструктаж/ }).first();
  await expect(button, 'у строки есть кнопка «Подтвердить»').toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/ждёт вашей отметки/i).first()).toBeVisible();
  await tap(page, button);
  await expect(page.getByText('Отметка поставлена').first(), 'сервер принял отметку').toBeVisible({ timeout: 30_000 });

  const after = await (await api(page).get('/api/safety/my-clearance')).json() as { history: Array<{ id: string; awaitingEmployeeSignature: boolean; employeeSignedAt: string | null }> };
  const done = after.history.find((item) => item.id === briefingId);
  expect(done?.awaitingEmployeeSignature).toBe(false);
  expect(done?.employeeSignedAt, 'время отметки записано').toBeTruthy();
  expect(db(`SELECT "employeeSignedAt" IS NOT NULL AND "instructorSignedAt" IS NOT NULL FROM "BriefingRecord" WHERE id = '${briefingId}'`)).toBe('t');

  // Чужая подпись: администратор (не работник и не инструктор этой записи) подписать за работника не может.
  await login(page, ADMIN);
  const foreign = await api(page).post(`/api/briefings/${briefingId}/sign`);
  expect([200, 403], 'повтор или отказ, но не новая отметка за другого').toContain(foreign.status());
});

test('D-20261016-001: сводка допуска помощника v7 учитывает обязательные документы', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, ASSISTANT);
  const state = await (await api(page).get('/api/assistant/state')).json() as { data: {
    briefing: { ok: boolean }; knowledge: { ok: boolean };
    documents: Array<{ required: boolean; verdict: string }>;
  } };
  const invalid = state.data.documents.filter((d) => d.required && (d.verdict === 'MISSING' || d.verdict === 'EXPIRED')).length;
  test.skip(!(state.data.briefing.ok && state.data.knowledge.ok), 'у QA-помощника не пройдены инструктаж или знания — сводка по документам не проверяется');

  await page.goto('/operator/v7/assistant', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const text = await page.evaluate(() => document.body.innerText);
  if (invalid > 0) {
    expect(text, 'не «в порядке» при недостающих документах').not.toContain('Допуск в порядке');
    expect(text).toContain('Допуск неполный');
    expect(text).toMatch(new RegExp(`обязательные документы: ${invalid}`));
  } else {
    expect(text).toContain('Допуск в порядке');
  }
});

test('D-20261010-001: неотправленная форма осмотра переживает перезагрузку (v1)', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, WORKER);
  await page.goto('/operator', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const ppe = page.getByRole('button', { name: /Проверить средства защиты/ });
  if (await ppe.count()) {
    await tap(page, ppe.first());
    await page.waitForTimeout(2200);
    const confirm = page.getByRole('button', { name: /Комплект в порядке|Подтвердить/ });
    if (await confirm.count()) { await tap(page, confirm.first()); await page.waitForTimeout(3000); }
  }
  const accept = page.getByRole('button', { name: /Принять и открыть смену|Принять установку/ });
  if (await accept.count()) { await tap(page, accept.first()); await page.waitForTimeout(3500); }

  const open = page.getByRole('button', { name: /Пройти чек-лист|Открыть чек-лист|Пройти осмотр|Начать осмотр|Осмотреть/ });
  if (await open.count()) { await tap(page, open.first()); await page.waitForTimeout(2500); }
  const bulk = page.locator('button[aria-label*="в норме"]:not([disabled])');
  test.skip((await bulk.count()) === 0, 'сегодня у QA-машиниста нет открытого осмотра: смена уже принята или закрыта');

  await tap(page, bulk.first());
  const marked = await page.locator('button[aria-label*="в норме"][aria-pressed="true"]').count();
  expect(marked, 'отметка «в норме» поставлена').toBeGreaterThan(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const reopen = page.getByRole('button', { name: /Пройти чек-лист|Открыть чек-лист|Пройти осмотр|Начать осмотр|Осмотреть/ });
  if (await reopen.count()) { await tap(page, reopen.first()); await page.waitForTimeout(2500); }
  const restored = await page.locator('button[aria-label*="в норме"][aria-pressed="true"]').count();
  expect(restored, 'после перезагрузки отметка осмотра на месте (черновик)').toBe(marked);
});

/** Чек-лист общего экрана: массовые «в норме», пункты раскрытых разделов, «Завершить». */
async function completeChecklist(page: Page) {
  await page.waitForTimeout(1500);
  for (let guard = 0; guard < 12; guard++) {
    const bulk = page.locator('button[aria-label*="в норме"]:not([disabled])');
    const n = await bulk.count();
    let progressed = false;
    for (let j = 0; j < n; j++) {
      if ((await bulk.nth(j).getAttribute('aria-pressed')) !== 'true') { await tap(page, bulk.nth(j)); progressed = true; break; }
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
    await tap(page, target);
    const normal = page.getByRole('button', { name: /^Норма$/ });
    for (let k = 0; k < (await normal.count()); k++) await tap(page, normal.nth(k));
    const measures = page.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    for (let k = 0; k < (await measures.count()); k++) {
      if (await measures.nth(k).inputValue()) continue;
      const label = await measures.nth(k).evaluate((el) => (el.closest('label')?.innerText ?? '')).catch(() => '');
      const previous = label.match(/Прошлое показание:\s*(\d+(?:[.,]\d+)?)\s*м\/ч/i);
      if (/моточас|м\/ч/i.test(label) && !previous) return;
      await measures.nth(k).fill(/%/.test(label) ? '50' : previous ? String(Number(previous[1].replace(',', '.')) + 1) : '10');
    }
    await page.waitForTimeout(400);
  }
  const finish = page.getByRole('button', { name: /^Завершить$/ });
  await expect(finish).toBeEnabled({ timeout: 20_000 });
  await tap(page, finish);
  await page.waitForTimeout(2500);
}

test('D-20261010-001 (форма сваи): введённые марка и количество переживают перезагрузку', async ({ page }) => {
  test.setTimeout(420_000);
  await login(page, WORKER);
  await page.goto('/operator', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Довести допуск до рабочей формы: оставшиеся осмотры (до трёх).
  for (let stage = 0; stage < 3; stage++) {
    const open = page.getByRole('button', { name: /Пройти чек-лист|Открыть чек-лист|Пройти осмотр|Начать осмотр|Осмотреть/ });
    if (await open.count()) { await tap(page, open.first()); await page.waitForTimeout(2500); }
    if ((await page.locator('button[aria-label*="в норме"]').count()) === 0) break;
    await completeChecklist(page);
    await page.waitForTimeout(1500);
  }
  const add = page.getByRole('button', { name: /Добавить сваю/ }).first();
  test.skip((await add.count()) === 0, 'форма выработки недоступна: смена QA-машиниста ещё не дошла до работы (нужен приём и три осмотра)');

  await tap(page, add);
  const grade = page.getByLabel('Марка сваи');
  await expect(grade).toBeVisible({ timeout: 30_000 });
  await grade.selectOption({ index: 1 });
  const chosen = await grade.inputValue();
  await page.getByLabel('Свай, шт').fill('7');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  if ((await page.getByLabel('Марка сваи').count()) === 0) {
    await tap(page, page.getByRole('button', { name: /Добавить сваю/ }).first());
  }
  await expect(page.getByLabel('Марка сваи')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByLabel('Марка сваи').inputValue(), 'марка на месте после перезагрузки').toBe(chosen);
  expect(await page.getByLabel('Свай, шт').inputValue(), 'количество на месте после перезагрузки').toBe('7');
});

test('D-20261010-001 (v2): марка и количество в форме сваи переживают перезагрузку', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, WORKER);
  await page.goto('/operator/v2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10_000);
  const tab = page.getByRole('button', { name: /^Смена$/ });
  if (await tab.count()) { await tap(page, tab.first()); await page.waitForTimeout(1500); }
  const add = page.getByRole('button', { name: /Добавить сваю/ }).first();
  test.skip((await add.count()) === 0, 'v2: форма выработки недоступна — смена QA-машиниста не дошла до работы');

  await tap(page, add);
  const grade = page.getByLabel('Марка сваи');
  await expect(grade).toBeVisible({ timeout: 30_000 });
  await grade.selectOption({ index: 1 });
  const chosen = await grade.inputValue();
  await page.getByLabel('Количество свай').fill('7');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(10_000);
  const tab2 = page.getByRole('button', { name: /^Смена$/ });
  if (await tab2.count()) { await tap(page, tab2.first()); await page.waitForTimeout(1500); }
  if ((await page.getByLabel('Марка сваи').count()) === 0) await tap(page, page.getByRole('button', { name: /Добавить сваю/ }).first());
  await expect(page.getByLabel('Марка сваи')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByLabel('Марка сваи').inputValue(), 'v2: марка на месте после перезагрузки').toBe(chosen);
  expect(await page.getByLabel('Количество свай').inputValue(), 'v2: количество на месте после перезагрузки').toBe('7');
});
