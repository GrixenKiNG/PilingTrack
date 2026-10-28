import { test, expect } from './fixtures/disposable.fixture';
import { TEST_USERS } from './fixtures/auth.fixture';
import { login } from './page-objects/login.page';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { getTodayInTimezone } from '@/lib/timezone';

async function owner() {
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'piling') throw new Error('Disposable DB required');
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  return db;
}

test('dispatcher draft, submit, daily projection, KPI and worker PDF', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Persisted key path runs once; existing flows cover mobile projects');
  test.setTimeout(120000);
  const db = await owner();
  const date = getTodayInTimezone();
  const draft = 'codex-draft-' + randomUUID();
  try {
    await db.query('INSERT INTO "Report" (id,"reportId","tenantId","userId","siteId",date,"updatedAt") VALUES ($1,$1,$2,$3,$4,$5,now())', [draft, 'codex-e1-a', 'codex-e1-admin', 'codex-e1-a-site', date]);
    await db.query('INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count) VALUES ($1,$2,$3,$4,3)', [randomUUID(), draft, 'codex-e1-a', 'codex-e1-a-grade']);
    await login(page, TEST_USERS.dispatcher.email, TEST_USERS.dispatcher.password);
    const analytics = async () => {
      const r = await page.request.get('/api/analytics/sites?siteId=codex-e1-a-site');
      expect(r.status()).toBe(200);
      return (await r.json()).analytics.find((s: { siteId: string }) => s.siteId === 'codex-e1-a-site');
    };
    expect((await analytics()).actualPiles).toBe(0);
    expect((await db.query('SELECT "totalPiles" FROM "SiteDailySummary" WHERE "siteId"=$1 AND date=$2', ['codex-e1-a-site', date])).rows[0]?.totalPiles || 0).toBe(0);
    await page.goto('/report');
    await page.getByRole('combobox', { name: 'Объект', exact: true }).click();
    await page.getByRole('option', { name: 'Codex объект a', exact: true }).click();
    await page.getByRole('combobox', { name: 'Установка', exact: true }).click();
    await page.getByRole('option', { name: 'Codex Woltman A', exact: true }).click();
    await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).click();
    await page.getByRole('option', { name: /Codex C60/ }).click();
    await page.getByRole('spinbutton', { name: 'Количество свай, шт.', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Добавить сваи в отчёт', exact: true }).click();
    expect((await analytics()).actualPiles).toBe(0);
    const [saved] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/reports/upsert') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Отправить отчёт', exact: true }).click()]);
    expect(saved.status(), await saved.text()).toBe(200);
    const persisted = await db.query('SELECT id,"reportId",status FROM "Report" WHERE "userId"=$1 AND "siteId"=$2 AND date=$3', ['codex-e1-dispatcher', 'codex-e1-a-site', date]);
    expect(persisted.rows[0].status).toBe('submitted');
    await expect.poll(async () => (await db.query('SELECT "totalPiles" FROM "SiteDailySummary" WHERE "siteId"=$1 AND date=$2', ['codex-e1-a-site', date])).rows[0]?.totalPiles, { timeout: 30000 }).toBe(3);
    await expect.poll(async () => (await analytics()).actualPiles, { timeout: 30000 }).toBe(3);
    await page.screenshot({ path: info.outputPath('report-sent.png'), fullPage: true });
    const pdf = await page.request.post('/api/reports/single-pdf', { headers: { Origin: new URL(page.url()).origin }, data: { reportId: persisted.rows[0].reportId } });
    expect(pdf.status(), await pdf.text()).toBe(202);
    const { jobId } = await pdf.json();
    await expect.poll(async () => {
      const r = await page.request.get(`/api/reports/single-pdf?jobId=${jobId}&action=status`);
      expect(r.status()).toBe(200);
      return (await r.json()).status;
    }, { timeout: 60000 }).toBe('completed');
    const file = await page.request.get(`/api/reports/single-pdf?jobId=${jobId}&action=download`);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');
  } finally { await db.end(); }
});

test('ADMIN creates and accepts a work order through UI', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Mutating persisted path runs once');
  await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
  await page.goto('/admin/maintenance');
  await page.getByRole('button', { name: 'Задача ТО', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый наряд ТО' });
  await dialog.locator('#wo-equipment').click();
  await page.getByRole('option', { name: 'Codex Woltman A', exact: true }).click();
  await dialog.locator('#wo-type').click();
  await page.getByRole('option', { name: 'Ремонт', exact: true }).click();
  await dialog.locator('#wo-status').click();
  await page.getByRole('option', { name: 'Выполнено', exact: true }).click();
  await dialog.locator('#wo-title').fill('Codex проверка наряда ' + randomUUID());
  await dialog.locator('#wo-work').fill('Проверены крепления и проведена диагностика');
  const [created] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/equipment/codex-e1-a-equipment/maintenance') && r.request().method() === 'POST'), dialog.getByRole('button', { name: 'Создать', exact: true }).click()]);
  expect(created.status(), await created.text()).toBe(201);
  const { record } = await created.json();
  await page.goto('/admin/maintenance/' + record.id);
  const [accepted] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/api/maintenance/${record.id}/accept`)), page.getByRole('button', { name: 'Принять', exact: true }).click()]);
  expect(accepted.status(), await accepted.text()).toBe(200);
  await page.reload();
  await expect(page.getByText(/✓ Принято/)).toBeVisible();
  const db = await owner();
  try { expect((await db.query('SELECT "acceptedById","acceptedAt" FROM "MaintenanceRecord" WHERE id=$1', [record.id])).rows[0].acceptedById).toBe('codex-e1-admin'); } finally { await db.end(); }
});

test('ADMIN deletes a cluster only after confirmation', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Destructive persisted path runs once');
  const db = await owner();
  const id = 'codex-cluster-' + randomUUID(); const name = 'Codex удаление ' + randomUUID();
  try {
    await db.query('INSERT INTO "Cluster" (id,"fieldId",name,"updatedAt") VALUES ($1,$2,$3,now())', [id, 'codex-e1-a-field', name]);
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    await page.goto('/admin/sites');
    await page.getByText('Codex объект a', { exact: true }).first().click();
    const remove = page.getByText(name, { exact: true }).locator('..').getByRole('button', { name: 'Удалить куст', exact: true });
    let requests = 0;
    page.on('request', r => { if (r.method() === 'DELETE' && r.url().includes('/hierarchy')) requests++; });
    await remove.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(name);
    expect(requests).toBe(0);
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect((await db.query('SELECT id FROM "Cluster" WHERE id=$1', [id])).rowCount).toBe(1);
    expect(requests).toBe(0);
    await remove.click();
    const [deleted] = await Promise.all([page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/hierarchy')), dialog.getByRole('button', { name: 'Удалить', exact: true }).click()]);
    expect(deleted.status(), await deleted.text()).toBe(200);
    expect(requests).toBe(1);
    expect((await db.query('SELECT id FROM "Cluster" WHERE id=$1', [id])).rowCount).toBe(0);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  } finally { await db.end(); }
});

test('F6 analytics failure marks production KPIs unavailable and refresh recovers', async ({ page }, info) => {
  await page.route('**/api/analytics/sites*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Own test outage"}' }));
  await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
  await expect(page.getByText('Данные не загрузились', { exact: true })).toHaveCount(3);
  const screenshot = info.outputPath('unavailable-kpi.png');
  await page.screenshot({ path: screenshot });
  await info.attach('unavailable-kpi', { path: screenshot, contentType: 'image/png' });
  await page.unroute('**/api/analytics/sites*');
  await page.getByRole('button', { name: 'Обновить дашборд', exact: true }).click();
  await expect(page.getByText('Данные не загрузились', { exact: true })).toHaveCount(0);
});

test('F4 Telegram Test sends the selected second channel id from the real UI', async ({ page }) => {
  await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
  await page.route('**/api/telegram/configs', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ configs: [
    { id: 'codex-ui-A', label: 'Own channel A', chatId: '-10011111111', enabled: true, botToken: 'masked' },
    { id: 'codex-ui-B', label: 'Own channel B', chatId: '-10022222222', enabled: true, botToken: 'masked' },
  ] }) }));
  let selected: unknown;
  await page.route('**/api/notifications/telegram/test', route => {
    selected = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, chatTitle: 'Own channel B' }) });
  });
  await page.goto('/admin/telegram');
  await page.getByRole('button', { name: 'Тест', exact: true }).nth(1).click();
  await expect.poll(() => selected).toEqual({ configId: 'codex-ui-B' });
});

test('F7 briefing print opens with no opener and no false blocked toast', async ({ page }, info) => {
  const db = await owner();
  const id = 'codex-print-' + randomUUID();
  try {
    await db.query('INSERT INTO "BriefingRecord" (id,"tenantId","userId",kind,"userName","userRole","documentCode","documentTitle","documentVersion","recordedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8,now())', [id, 'codex-e1-a', 'codex-e1-operator', 'INSTRUCTION', 'Codex print proof', 'OPERATOR', 'CODEX-PRINT', '1']);
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    const bootstrap = await page.request.get('/api/readiness/bootstrap');
    expect(bootstrap.status(), await bootstrap.text()).toBe(200);
    await page.goto('/admin/safety?view=briefings');
    const print = page.getByRole('button', { name: 'Печатная форма', exact: true });
    await expect(print).toBeEnabled();
    const popupPromise = page.waitForEvent('popup');
    await print.click();
    const popup = await popupPromise;
    await popup.waitForURL(/\/print\/briefing-journal\?/);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await expect(popup.getByText('Codex print proof', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Браузер заблокировал окно печати. Разрешите всплывающие окна и повторите.', { exact: true })).toHaveCount(0);
    const screenshot = info.outputPath('briefing-print.png');
    await popup.screenshot({ path: screenshot });
    await info.attach('briefing-print', { path: screenshot, contentType: 'image/png' });
    await popup.close();
  } finally {
    await db.query('DELETE FROM "BriefingRecord" WHERE id=$1 AND "tenantId"=$2', [id, 'codex-e1-a']);
    await db.end();
  }
});

for (const multiple of [false, true]) test('v3: real legacy report reaches dispatcher (' + (multiple ? 'multiple rigs' : 'single rig') + ')', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await createRoleAuditFixture();
  const db = await owner();
  const equipmentName = 'V3 QA ' + fixture.equipmentId;
  const observed: Record<string, unknown> = {};
  try {
    await db.query('UPDATE "Equipment" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.equipmentId, fixture.tenantId, equipmentName]);
    if (multiple) {
      const id = randomUUID();
      await db.query('INSERT INTO "Equipment" (id,"tenantId",name,model,kind,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, fixture.tenantId, 'V3 вторая установка', 'QA', 'PILE_DRIVER']);
      await db.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), 'V3 вторая бригада', fixture.users.OPERATOR.id, id, fixture.siteId]);
    }
    await login(page, fixture.users.OPERATOR.email, fixture.password);
    const mobile = async () => { const r = await page.request.get('/api/operator/mobile/state'); expect(r.status()).toBe(200); return (await r.json()).data; };
    observed.before = await mobile();
    await page.goto('/operator/v3');
    await expect(page.getByRole('button', { name: /^Начало смены/ })).toBeEnabled();
    observed.dashboardButtons = await page.getByRole('button').allTextContents();
    observed.canonicalNextControls = await page.getByRole('button', { name: /^Следующий шаг:/ }).count();
    await page.getByRole('button', { name: /^Начало смены/ }).click();
    await expect(page).toHaveURL(/\/operator\/v3\/report$/);
    await page.getByRole('combobox', { name: 'Объект', exact: true }).click();
    await page.getByRole('option', { name: 'QA полигон', exact: true }).click();
    await page.getByRole('combobox', { name: 'Установка', exact: true }).click();
    await page.getByRole('option', { name: equipmentName, exact: true }).click();
    await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).click();
    await page.getByRole('option', { name: /QA C120.30/ }).click();
    await expect(page.getByRole('combobox', { name: 'Марка сваи', exact: true })).toBeFocused();
    const count = page.getByRole('spinbutton', { name: 'Количество свай, шт.', exact: true });
    await count.fill('2');
    await expect(count).toHaveValue('2');
    observed.inputBeforeAdd = await count.inputValue();
    await page.getByRole('button', { name: 'Добавить сваи в отчёт', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Удалить сваи QA C120.30 из отчёта', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Отправить отчёт', exact: true })).toBeEnabled();
    const [saved] = await Promise.all([page.waitForResponse(r => r.url().includes('/api/reports/upsert') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Отправить отчёт', exact: true }).click()]);
    expect(saved.status(), await saved.text()).toBe(200);
    const report = (await db.query('SELECT id,"reportId",status,"shiftId" FROM "Report" WHERE "tenantId"=$1 AND "userId"=$2 AND "equipmentId"=$3', [fixture.tenantId, fixture.users.OPERATOR.id, fixture.equipmentId])).rows;
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('submitted');
    expect(Number((await db.query('SELECT sum(count) AS count FROM "PileWork" WHERE "tenantId"=$1 AND "reportId"=$2', [fixture.tenantId, report[0].id])).rows[0].count)).toBe(2);
    await expect.poll(async () => (await db.query('SELECT published,projected FROM "OutboxEvent" WHERE "tenantId"=$1 AND "aggregateId"=$2 AND type=$3', [fixture.tenantId, report[0].reportId, 'ReportSubmitted'])).rows, { timeout: 30000 }).toEqual([{ published: true, projected: true }]);
    await expect.poll(async () => (await db.query('SELECT "totalPiles" FROM "ReportAnalytics" WHERE "tenantId"=$1 AND "reportId"=$2', [fixture.tenantId, report[0].reportId])).rows[0]?.totalPiles, { timeout: 30000 }).toBe(2);
    expect((await db.query('SELECT action,"actorId" FROM "ReportAudit" WHERE "reportId"=$1 AND action=$2', [report[0].reportId, 'created'])).rows).toEqual([{action:'created',actorId:fixture.users.OPERATOR.id}]);
    observed.report = report[0]; observed.after = await mobile();
    await page.screenshot({ path: info.outputPath('v3-submitted.png'), fullPage: true });
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.DISPATCHER.email, fixture.password);
    await page.goto('/admin/reports');
    await page.getByPlaceholder('Поиск по оператору, объекту, установке').fill(equipmentName);
    const reportButton = page.getByRole('button', { name: 'Показать в правой панели', exact: true });
    await expect(reportButton).toHaveCount(1); await reportButton.click();
    await expect(page.getByRole('heading', { name: 'Отчёт #' + report[0].reportId, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('v3-dispatcher.png'), fullPage: true });
  } finally { await db.end(); await info.attach('v3-legacy-evidence', { body: JSON.stringify(observed), contentType: 'application/json' }); }
});

test('crew lifecycle: UI assignments, roster, confirmation, audit and read-only mechanic', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await createRoleAuditFixture();
  const db = await owner();
  const prefix = 'Бригада QA ' + randomUUID();
  const equipment = [randomUUID(), randomUUID()];
  const site = randomUUID();
  const reportId = randomUUID();
  const observations: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const observe = () => page.on('pageerror', error => errors.push(error.message));
  observe();
  const switchRole = async (role: 'ADMIN' | 'MECHANIC' | 'OPERATOR') => {
    const context = page.context();
    const logout = await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    expect(logout.status()).toBe(200);
    await page.close();
    page = await context.newPage();
    observe();
    await login(page, fixture.users[role].email, fixture.password);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).user.role).toBe(role);
  };
  try {
    await db.query('UPDATE "User" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.users.OPERATOR.id, fixture.tenantId, prefix + ' машинист']);
    await db.query('UPDATE "User" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.users.ASSISTANT.id, fixture.tenantId, prefix + ' помощник']);
    await db.query('UPDATE "Site" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.siteId, fixture.tenantId, prefix + ' исходный объект']);
    for (const [index, id] of equipment.entries()) await db.query('INSERT INTO "Equipment" (id,"tenantId",name,model,kind,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, fixture.tenantId, prefix + ' установка ' + index, 'КБУРГ', 'PILE_DRIVER']);
    await db.query('INSERT INTO "Site" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [site, fixture.tenantId, prefix + ' объект']);
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await page.goto('/admin/crews');
    await page.getByRole('button', { name: 'Добавить бригаду', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Новая бригада', exact: true });
    const choose = async (label: string, option: string) => {
      const control = dialog.getByRole('combobox', { name: label });
      await control.click();
      await page.getByRole('option', { name: option, exact: true }).click();
      await expect(control).toBeFocused();
    };
    await choose('Оператор', prefix + ' машинист');
    await choose('Установка', prefix + ' установка 0');
    await choose('Объект', prefix + ' исходный объект');
    await dialog.getByRole('textbox', { name: 'Название' }).fill(prefix);
    await dialog.getByRole('button', { name: 'Выбрать помощников', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Выбрать помощников', exact: true });
    await picker.locator('label').filter({ hasText: prefix + ' помощник' }).getByRole('checkbox').check();
    await picker.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(picker).toHaveCount(0);
    const createdResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crews' && r.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(200);
    const { crew } = await created.json();
    const row = async () => (await db.query('SELECT name,"operatorId","equipmentId","siteId","isActive" FROM "Crew" WHERE id=$1', [crew.id])).rows[0];
    const roster = async () => (await db.query('SELECT "userId",name FROM "CrewAssistant" WHERE "crewId"=$1', [crew.id])).rows;
    expect(await row()).toEqual({ name: prefix, operatorId: fixture.users.OPERATOR.id, equipmentId: equipment[0], siteId: fixture.siteId, isActive: true });
    expect(await roster()).toEqual([{ userId: fixture.users.ASSISTANT.id, name: prefix + ' помощник' }]);
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button').filter({ has: page.getByText(prefix, { exact: true }) }).click();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Редактировать бригаду', exact: true });
    await choose('Установка', prefix + ' установка 1');
    await choose('Объект', prefix + ' объект');
    await dialog.getByRole('textbox', { name: 'Название' }).fill(prefix + ' изменена');
    await dialog.getByRole('button', { name: 'Изменить состав помощников', exact: true }).click();
    await picker.locator('label').filter({ hasText: prefix + ' помощник' }).getByRole('checkbox').uncheck();
    await picker.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(picker).toHaveCount(0);
    const updatedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crews/' + crew.id && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const updated = await updatedResponse;
    expect(updated.status(), await updated.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect(await row()).toEqual({ name: prefix + ' изменена', operatorId: fixture.users.OPERATOR.id, equipmentId: equipment[1], siteId: site, isActive: true });
    expect(await roster()).toEqual([]);
    observations.push({ step: 'create and edit through UI', crewId: crew.id, state: await row(), roster: await roster() });
    await switchRole('OPERATOR');
    let state = await page.request.get('/api/operator/mobile/state');
    expect(state.status()).toBe(200);
    let options = (await state.json()).data.options;
    expect(options).toContainEqual({ crewId: crew.id, equipmentId: equipment[1], equipmentName: prefix + ' установка 1', siteName: prefix + ' объект' });
    expect(options.some((option: { equipmentId: string }) => option.equipmentId === equipment[0])).toBe(false);
    await switchRole('MECHANIC');
    await page.goto('/admin/crews');
    await expect(page.getByText(prefix + ' изменена', { exact: true }).first()).toBeVisible();
    await page.getByRole('button').filter({ has: page.getByText(prefix + ' изменена', { exact: true }) }).click();
    await expect(page.getByRole('button', { name: 'Добавить бригаду', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Деактивировать', exact: true })).toHaveCount(0);
    const before = await row();
    const auditCount = (await db.query('SELECT id FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2', ['crews', crew.id])).rowCount;
    for (const method of ['PUT', 'DELETE']) {
      const response = await page.request.fetch('/api/crews/' + crew.id, { method, headers: { Origin: new URL(page.url()).origin }, ...(method === 'PUT' ? { data: { name: prefix + ' forbidden' } } : {}) });
      expect(response.status()).toBe(403);
      expect(await row()).toEqual(before);
    }
    expect((await db.query('SELECT id FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2', ['crews', crew.id])).rowCount).toBe(auditCount);
    observations.push({ step: 'mechanic reads; UI and valid direct mutations denied', state: await row() });
    await switchRole('ADMIN');
    await page.goto('/admin/crews');
    await page.getByRole('button').filter({ has: page.getByText(prefix + ' изменена', { exact: true }) }).click();
    await db.query('INSERT INTO "Report" (id,"reportId","tenantId","userId","equipmentId","siteId",date,"updatedAt") VALUES ($1,$1,$2,$3,$4,$5,$6,now())', [reportId, fixture.tenantId, fixture.users.OPERATOR.id, equipment[0], fixture.siteId, getTodayInTimezone()]);
    const history = async () => (await db.query('SELECT id,"userId","equipmentId","siteId",status FROM "Report" WHERE id=$1 AND "tenantId"=$2', [reportId, fixture.tenantId])).rows;
    const originalReport = await history();
    expect(originalReport).toHaveLength(1);
    let deletes = 0;
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/crews/' + crew.id && request.method() === 'DELETE') deletes++; });
    await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Деактивировать бригаду?', exact: true });
    await expect(confirmation).toContainText('Её отчёты сохранятся');
    expect(deletes).toBe(0);
    await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect((await row()).isActive).toBe(true);
    expect(deletes).toBe(0);
    await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
    const deletedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crews/' + crew.id && r.request().method() === 'DELETE');
    await confirmation.getByRole('button', { name: 'Деактивировать', exact: true }).click();
    const deleted = await deletedResponse;
    expect(deleted.status(), await deleted.text()).toBe(200);
    await expect(confirmation).toHaveCount(0);
    expect(deletes).toBe(1);
    expect((await row()).isActive).toBe(false);
    expect(await history()).toEqual(originalReport);
    await page.screenshot({ path: info.outputPath('crew-deactivated.png'), fullPage: true });
    await switchRole('OPERATOR');
    state = await page.request.get('/api/operator/mobile/state');
    expect(state.status()).toBe(200);
    options = (await state.json()).data.options;
    expect(options.some((option: { crewId: string }) => option.crewId === crew.id)).toBe(false);
    await switchRole('ADMIN');
    await page.goto('/admin/crews');
    await page.getByRole('button').filter({ has: page.getByText(prefix + ' изменена', { exact: true }) }).click();
    const reactivatedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/crews/' + crew.id && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Активировать', exact: true }).click();
    const reactivated = await reactivatedResponse;
    expect(reactivated.status(), await reactivated.text()).toBe(200);
    expect((await row()).isActive).toBe(true);
    const audit = (await db.query('SELECT action,"actorId",metadata FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2 ORDER BY "createdAt",id', ['crews', crew.id])).rows;
    expect(audit.map(row => row.action)).toEqual(['crew.created', 'crew.updated', 'crew.deleted', 'crew.updated']);
    expect(audit.every(row => row.actorId === fixture.users.ADMIN.id)).toBe(true);
    expect(audit[1].metadata.before.equipmentId).toBe(equipment[0]);
    expect(audit[1].metadata.after.equipmentId).toBe(equipment[1]);
    expect(audit[1].metadata.before.assistants).toEqual([prefix + ' помощник']);
    expect(audit[1].metadata.after.assistants).toEqual([]);
    expect(audit[2].metadata.deactivated).toBe(true);
    const outbox = (await db.query('SELECT type,published,projected FROM "OutboxEvent" WHERE "aggregateId"=$1 ORDER BY "occurredAt",id', [crew.id])).rows;
    expect(outbox.map(row => row.type)).toEqual(expect.arrayContaining(['CrewCreated', 'CrewUpdated', 'CrewEquipmentAssigned', 'CrewAssigned', 'CrewDeactivated', 'CrewReactivated']));
    expect(await history()).toEqual(originalReport);
    observations.push({ step: 'confirmed soft delete and reactivation; fixture report retained', state: await row(), audit, outbox, retainedReport: await history() });
    await switchRole('OPERATOR');
    state = await page.request.get('/api/operator/mobile/state');
    expect(state.status()).toBe(200);
    expect((await state.json()).data.options).toContainEqual({ crewId: crew.id, equipmentId: equipment[1], equipmentName: prefix + ' установка 1', siteName: prefix + ' объект' });
    expect(errors).toEqual([]);
  } finally {
    await info.attach('crew-lifecycle', { body: JSON.stringify({ observations, errors }, null, 2), contentType: 'application/json' });
    await db.end();
  }
});

test('equipment access: operator cannot read an unassigned rig by direct id', async ({ page }, info) => {
  const fixture = await createRoleAuditFixture();
  const db = await owner();
  const equipmentId = randomUUID();
  const secondAssignedId = randomUUID();
  const marker = 'QA-private-' + randomUUID();
  const observations: Array<Record<string, unknown>> = [];
  try {
    await db.query('INSERT INTO "Equipment" (id,name,model,"tenantId",vin,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [equipmentId, marker, 'QA unassigned', fixture.tenantId, marker]);
    await db.query('INSERT INTO "Equipment" (id,name,"tenantId","updatedAt") VALUES ($1,$2,$3,now())', [secondAssignedId, 'QA second assigned', fixture.tenantId]);
    await db.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), 'QA second crew', fixture.users.OPERATOR.id, secondAssignedId, fixture.siteId]);
    expect((await db.query('SELECT id FROM "Crew" WHERE "equipmentId"=$1 AND "operatorId"=$2 AND "isActive"=true', [equipmentId, fixture.users.OPERATOR.id])).rowCount).toBe(0);
    await login(page, fixture.users.OPERATOR.email, fixture.password);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).user.id).toBe(fixture.users.OPERATOR.id);
    const list = await page.request.get('/api/equipment');
    expect(list.status()).toBe(200);
    const listed = (await list.json()).data as Array<{ id: string }>;
    expect(listed.some(row => row.id === fixture.equipmentId)).toBe(true);
    expect(listed.some(row => row.id === equipmentId)).toBe(false);
    expect(listed.some(row => row.id === secondAssignedId)).toBe(true);
    const own = await page.request.get('/api/equipment/' + fixture.equipmentId);
    expect(own.status()).toBe(200);
    const secondAssigned = await page.request.get('/api/equipment/' + secondAssignedId);
    expect(secondAssigned.status()).toBe(200);
    const details = await page.request.get('/api/equipment/' + equipmentId + '/details');
    const direct = await page.request.get('/api/equipment/' + equipmentId);
    const text = await direct.text();
    observations.push({ operatorId: fixture.users.OPERATOR.id, tenantId: fixture.tenantId, assignedEquipmentId: fixture.equipmentId, unassignedEquipmentId: equipmentId, unassignedMarker: marker, listedEquipmentIds: listed.map(row => row.id), ownStatus: own.status(), secondAssignedId, secondAssignedStatus: secondAssigned.status(), compositeDetailsStatus: details.status(), directStatus: direct.status(), directIncludesUnassignedMarker: text.includes(marker), directResponse: text });
    expect(details.status()).toBe(403);
    expect([403, 404], 'operator must not bypass the assignment filter by using a direct equipment id').toContain(direct.status());
    expect(text).not.toContain(marker);
  } finally {
    await info.attach('equipment-assignment-access', { body: JSON.stringify({ observations }, null, 2), contentType: 'application/json' });
    await db.end();
  }
});

test('equipment multiple: operator can read and record fuel and meters for both assigned rigs', async ({ page }, info) => {
  const fixture = await createRoleAuditFixture();
  const db = await owner();
  const secondId = randomUUID();
  const unassignedId = randomUUID();
  const observations: Array<Record<string, unknown>> = [];
  try {
    for (const id of [secondId, unassignedId]) await db.query('INSERT INTO "Equipment" (id,name,"tenantId","engineHoursTotal","fuelTankLiters","updatedAt") VALUES ($1,$2,$3,100,400,now())', [id, 'QA multiple resource rig', fixture.tenantId]);
    await db.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), 'QA second meter crew', fixture.users.OPERATOR.id, secondId, fixture.siteId]);
    const assigned = (await db.query('SELECT c.id,c."equipmentId" FROM "Crew" c JOIN "Equipment" e ON e.id=c."equipmentId" WHERE c."operatorId"=$1 AND c."isActive"=true AND e."tenantId"=$2 ORDER BY c.id', [fixture.users.OPERATOR.id, fixture.tenantId])).rows;
    expect(assigned.map(row => row.equipmentId).sort()).toEqual([fixture.equipmentId, secondId].sort());
    await login(page, fixture.users.OPERATOR.email, fixture.password);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    expect((await me.json()).user.id).toBe(fixture.users.OPERATOR.id);
    const outcomes: Array<{ equipmentId: string; resource: string; method: string; status: number; body: string }> = [];
    const foreign: typeof outcomes = [];
    const origin = new URL(page.url()).origin;
    for (const equipmentId of [fixture.equipmentId, secondId, unassignedId]) {
      const card = await page.request.get('/api/equipment/' + equipmentId);
      expect(card.status()).toBe(equipmentId === unassignedId ? 404 : 200);
      for (const resource of ['meter-readings', 'fuel']) {
        for (const method of ['GET', 'POST']) {
          const data = resource === 'meter-readings' ? { engineHours: 101, source: 'MANUAL', note: 'QA multiple rigs' } : { litersAdded: 10, tankPercent: 80, source: 'MANUAL', note: 'QA multiple rigs' };
          const response = await page.request.fetch('/api/equipment/' + equipmentId + '/' + resource, { method, headers: { Origin: origin }, ...(method === 'POST' ? { data } : {}) });
          (equipmentId === unassignedId ? foreign : outcomes).push({ equipmentId, resource, method, status: response.status(), body: await response.text() });
        }
      }
    }
    const ids = [fixture.equipmentId, secondId, unassignedId];
    const meterRows = (await db.query('SELECT id,"equipmentId","recordedById","engineHours" FROM "MeterReading" WHERE "tenantId"=$1 AND "equipmentId"=ANY($2::text[]) ORDER BY id', [fixture.tenantId, ids])).rows;
    const fuelRows = (await db.query('SELECT id,"equipmentId","recordedById","litersAdded","tankPercent" FROM "FuelLog" WHERE "tenantId"=$1 AND "equipmentId"=ANY($2::text[]) ORDER BY id', [fixture.tenantId, ids])).rows;
    const auditRows = (await db.query('SELECT action,"actorId","targetId" FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=ANY($2::text[]) ORDER BY "createdAt",id', ['equipment', [...meterRows, ...fuelRows].map(row => row.id)])).rows;
    observations.push({ operatorId: fixture.users.OPERATOR.id, tenantId: fixture.tenantId, assigned, outcomes, foreign, unassignedId, meterRows, fuelRows, auditRows });
    for (const outcome of foreign) expect([403, 404]).toContain(outcome.status);
    expect([...meterRows, ...fuelRows].some(row => row.equipmentId === unassignedId)).toBe(false);
    for (const outcome of outcomes) expect(outcome.status, 'assigned rig ' + outcome.equipmentId + ', resource ' + outcome.resource + ', method ' + outcome.method).toBe(outcome.method === 'POST' ? 201 : 200);
    expect(meterRows).toHaveLength(2);
    expect(fuelRows).toHaveLength(2);
    expect([...meterRows, ...fuelRows].every(row => row.recordedById === fixture.users.OPERATOR.id)).toBe(true);
    expect(auditRows.map(row => row.action).sort()).toEqual(['equipment.fuel.created', 'equipment.fuel.created', 'meter.reading.added', 'meter.reading.added'].sort());
    expect(auditRows.every(row => row.actorId === fixture.users.OPERATOR.id)).toBe(true);
  } finally {
    await info.attach('equipment-multiple-resource-access', { body: JSON.stringify({ observations }, null, 2), contentType: 'application/json' });
    await db.end();
  }
});
