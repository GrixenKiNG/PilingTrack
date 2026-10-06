import { test, expect } from './fixtures/disposable.fixture';
import { TEST_USERS } from './fixtures/auth.fixture';
import { login } from './page-objects/login.page';
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
