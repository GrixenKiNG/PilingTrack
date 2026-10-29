import { TEST_USERS } from './fixtures/auth.fixture';
import { expect, test } from './fixtures/disposable.fixture';
import { login } from './page-objects/login.page';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { Client } from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { getTodayInTimezone } from '@/lib/timezone';

const ADMIN = { email: TEST_USERS.admin.email, password: TEST_USERS.admin.password };

test.describe('Пользователи — операционный модуль', () => {
  test('таблица, поиск и правая панель работают на desktop и mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
    await expect(page.getByText('Бригада / установка')).toBeVisible();
    await expect(page.getByPlaceholder('ФИО, email или телефон')).toBeVisible();

    // Панель сведений никого не подставляет сама (admin-users.tsx: activeId) —
    // вкладки появляются после выбора человека в списке.
    const firstRow = page.locator('section [role="button"]').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    for (const tab of ['Обзор', 'Закрепление', 'Активность', 'Доступ', 'История']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    }
    const rowText = await firstRow.innerText();
    const email = rowText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
    expect(email).toBeTruthy();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: guarded by the toBeTruthy() assertion above
    await page.getByPlaceholder('ФИО, email или телефон').fill(email!);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: guarded by the toBeTruthy() assertion above
    await expect(firstRow).toContainText(email!);

    if (process.env.CAPTURE_USERS_UI) {
      await page.screenshot({ path: 'C:/tmp/pilingtrack-users-desktop.png', fullPage: true });
    }

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByRole('tab', { name: 'Обзор' })).toBeVisible();
    const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wideOverflow).toBeLessThanOrEqual(1);
    if (process.env.CAPTURE_USERS_UI) {
      await page.screenshot({ path: 'C:/tmp/pilingtrack-users-wide.png', fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    if (process.env.CAPTURE_USERS_UI) {
      await page.screenshot({ path: 'C:/tmp/pilingtrack-users-mobile.png', fullPage: true });
    }
  });
});

test('users and document lifecycle: UI writes, admission, session revocation and audit', async ({ page }, info) => {
  test.setTimeout(300_000);
  const fixture = await createRoleAuditFixture();
  const ownerUrl = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  if (ownerUrl.hostname !== '127.0.0.1' || ownerUrl.pathname !== '/codex_test' || ownerUrl.username !== 'piling') throw Error('Owned disposable database required');
  const db = new Client({ connectionString: ownerUrl.toString() });
  await db.connect();
  const token = randomUUID();
  const name = 'Пользователь QA ' + token;
  const email = token + '@users-night.test';
  const typeId = randomUUID();
  const documentName = 'Удостоверение QA ' + token;
  const number = 'QA-' + token;
  const today = getTodayInTimezone();
  const offsetDate = (days: number) => { const date = new Date(today + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const observations: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  const observe = () => page.on('pageerror', error => errors.push(error.message));
  observe();
  const browser = page.context().browser();
  if (!browser) throw Error('Browser required');
  const subjectContext = await browser.newContext({
    baseURL: info.project.use.baseURL,
    viewport: page.viewportSize() ?? undefined,
    userAgent: info.project.use.userAgent,
    deviceScaleFactor: info.project.use.deviceScaleFactor,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'x-forwarded-for': '127.' + randomInt(1, 255) + '.' + randomInt(1, 255) + '.' + randomInt(1, 255) },
  });
  await subjectContext.route('**/*', async route => {
    const request = route.request();
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.abort('blockedbyclient');
    else await route.continue();
  });
  let subjectPage = await subjectContext.newPage();
  subjectPage.on('pageerror', error => errors.push(error.message));
  const switchRole = async (role: 'ADMIN' | 'SAFETY_ENGINEER' | 'OPERATOR') => {
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
    await db.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","requiresExpiry","requiredForOperator","updatedAt") VALUES ($1,$2,$3,$4,true,true,now())', [typeId, fixture.tenantId, documentName, documentName.toLowerCase()]);
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Новый пользователь', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Новый пользователь', exact: true });
    // The current FormField has a visual label without htmlFor. Follow the
    // visible field container; do not change product markup from the harness.
    const field = (label: string) => dialog.locator('label').filter({ hasText: new RegExp('^' + label + '$') }).locator('..').locator('input');
    await field('Имя').fill(name);
    await field('Email').fill(email);
    await field('Телефон').fill('+79990001122');
    await field('Пароль').fill(fixture.password);
    const roleControl = dialog.getByRole('combobox', { name: 'Роль', exact: true });
    await roleControl.click();
    await page.getByRole('option', { name: 'Оператор', exact: true }).click();
    await expect(roleControl).toBeFocused();
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(201);
    const userId = (await created.json()).user.id as string;
    const user = async () => (await db.query('SELECT id,"tenantId",name,email,phone,role,"isActive" FROM "User" WHERE id=$1 AND "tenantId"=$2', [userId, fixture.tenantId])).rows[0];
    expect(await user()).toEqual({ id: userId, tenantId: fixture.tenantId, name, email, phone: '+79990001122', role: 'OPERATOR', isActive: true });
    await expect(dialog).toHaveCount(0);
    const cachedResponse = await page.request.get('/api/users');
    const freshResponse = await page.request.get('/api/users?_ts=' + Date.now());
    expect(cachedResponse.status()).toBe(200);
    expect(freshResponse.status()).toBe(200);
    const cachedRows = (await cachedResponse.json()).users as Array<{ id: string }>;
    const freshRows = (await freshResponse.json()).users as Array<{ id: string }>;
    observations.push({ step: 'read-after-create: cache and authoritative response', user: await user(), cachedCount: cachedRows.length, freshCount: freshRows.length, cachedHasCreatedUser: cachedRows.some(row => row.id === userId), freshHasCreatedUser: freshRows.some(row => row.id === userId) });
    // _ts is diagnostic only; normal GET and the UI must be fresh themselves.
    expect(freshRows.some(row => row.id === userId)).toBe(true);
    expect(cachedRows.some(row => row.id === userId), 'normal users GET must reflect the committed creation').toBe(true);
    const openUser = async () => {
      await page.goto('/admin/users');
      await page.getByPlaceholder('ФИО, email или телефон').fill(email);
      await page.getByRole('button').filter({ has: page.getByText(email, { exact: true }) }).click();
    };
    await openUser();
    await page.getByRole('tab', { name: 'Доступ', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Редактировать пользователя', exact: true });
    await field('Имя').fill(name + ' изменён');
    await field('Телефон').fill('+79990002233');
    const editedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const edited = await editedResponse;
    expect(edited.status(), await edited.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect((await user()).name).toBe(name + ' изменён');
    expect((await user()).phone).toBe('+79990002233');
    await login(subjectPage, email, fixture.password);
    const subjectMe = await subjectPage.request.get('/api/auth/me');
    expect(subjectMe.status()).toBe(200);
    expect((await subjectMe.json()).user.id).toBe(userId);
    const documentCheck = async () => {
      const response = await subjectPage.request.get('/api/operator/mobile/state');
      expect(response.status()).toBe(200);
      return (await response.json()).data.identity.documents.find((row: { typeId: string }) => row.typeId === typeId);
    };
    expect((await documentCheck()).verdict).toBe('MISSING');
    await page.getByRole('tab', { name: 'Документы', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Документ работника', exact: true });
    const typeControl = dialog.getByRole('combobox', { name: 'Вид документа', exact: true });
    await typeControl.click();
    await page.getByRole('option', { name: documentName, exact: true }).click();
    await expect(typeControl).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Номер', exact: true }).fill(number);
    await dialog.getByLabel('Выдан', { exact: true }).fill(offsetDate(-365));
    await dialog.getByLabel('Действует до', { exact: true }).fill(offsetDate(-1));
    await dialog.getByRole('textbox', { name: 'Примечание', exact: true }).fill('Синтетическая проверка срока через UI');
    const documentPath = '/api/users/' + userId + '/documents';
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === documentPath && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status(), await saved.text()).toBe(201);
    const documentId = (await saved.json()).document.id as string;
    await expect(dialog).toHaveCount(0);
    const documentRow = async () => (await db.query('SELECT id,"userId","tenantId","typeId",number,"expiresAt" FROM "UserDocument" WHERE id=$1 AND "tenantId"=$2', [documentId, fixture.tenantId])).rows[0];
    expect((await documentRow()).userId).toBe(userId);
    expect((await documentRow()).expiresAt.toISOString().slice(0, 10)).toBe(offsetDate(-1));
    expect((await documentCheck()).verdict).toBe('EXPIRED');
    await page.getByRole('button', { name: 'Изменить документ', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Изменить документ', exact: true });
    await dialog.getByLabel('Действует до', { exact: true }).fill(offsetDate(90));
    const extendedResponse = page.waitForResponse(response => new URL(response.url()).pathname === documentPath + '/' + documentId && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const extended = await extendedResponse;
    expect(extended.status(), await extended.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect((await documentRow()).expiresAt.toISOString().slice(0, 10)).toBe(offsetDate(90));
    expect((await documentCheck()).verdict).toBe('VALID');
    observations.push({ step: 'user created and edited; document MISSING to EXPIRED to VALID', user: await user(), document: await documentRow() });
    await switchRole('SAFETY_ENGINEER');
    const safetyRead = await page.request.get(documentPath);
    expect(safetyRead.status()).toBe(200);
    expect((await safetyRead.json()).documents.some((row: { id: string; number: string }) => row.id === documentId && row.number === number)).toBe(true);
    await switchRole('OPERATOR');
    const forbiddenRead = await page.request.get(documentPath);
    expect(forbiddenRead.status()).toBe(403);
    expect(await forbiddenRead.text()).not.toContain(number);
    const beforeDocument = await documentRow();
    const beforeAudit = (await db.query('SELECT id FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2', ['users', userId])).rowCount;
    for (const method of ['PUT', 'DELETE']) {
      const response = await page.request.fetch(documentPath + '/' + documentId, { method, headers: { Origin: new URL(page.url()).origin }, ...(method === 'PUT' ? { data: { number: 'FORBIDDEN' } } : {}) });
      expect(response.status()).toBe(403);
      expect(await documentRow()).toEqual(beforeDocument);
    }
    expect((await db.query('SELECT id FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2', ['users', userId])).rowCount).toBe(beforeAudit);
    observations.push({ step: 'safety reads; another operator cannot read or mutate this document', document: await documentRow() });
    await switchRole('ADMIN');
    await openUser();
    await page.getByRole('tab', { name: 'Документы', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
    const documentConfirm = page.getByRole('alertdialog', { name: 'Удалить документ?', exact: true });
    await documentConfirm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(documentConfirm).toHaveCount(0);
    expect(await documentRow()).toEqual(beforeDocument);
    await page.getByRole('button', { name: 'Удалить документ', exact: true }).click();
    const deletedDocumentResponse = page.waitForResponse(response => new URL(response.url()).pathname === documentPath + '/' + documentId && response.request().method() === 'DELETE');
    await documentConfirm.getByRole('button', { name: 'Удалить', exact: true }).click();
    const deletedDocument = await deletedDocumentResponse;
    expect(deletedDocument.status(), await deletedDocument.text()).toBe(200);
    await expect(documentConfirm).toHaveCount(0);
    expect(await documentRow()).toBeUndefined();
    expect((await documentCheck()).verdict).toBe('MISSING');
    await page.getByRole('tab', { name: 'Доступ', exact: true }).click();
    await page.getByRole('button', { name: 'Заблокировать', exact: true }).click();
    const blockConfirm = page.getByRole('alertdialog', { name: 'Заблокировать пользователя?', exact: true });
    await blockConfirm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(blockConfirm).toHaveCount(0);
    expect((await user()).isActive).toBe(true);
    expect((await subjectPage.request.get('/api/auth/me')).status()).toBe(200);
    await page.getByRole('button', { name: 'Заблокировать', exact: true }).click();
    const blockedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'PUT');
    await blockConfirm.getByRole('button', { name: 'Заблокировать доступ', exact: true }).click();
    const blocked = await blockedResponse;
    expect(blocked.status(), await blocked.text()).toBe(200);
    await expect(blockConfirm).toHaveCount(0);
    expect((await user()).isActive).toBe(false);
    expect((await subjectPage.request.get('/api/auth/me')).status()).toBe(401);
    await subjectPage.reload();
    await expect(subjectPage).toHaveURL(/\/login(?:\?|$)/);
    const unblockedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Разблокировать', exact: true }).click();
    const unblocked = await unblockedResponse;
    expect(unblocked.status(), await unblocked.text()).toBe(200);
    expect((await user()).isActive).toBe(true);
    await subjectPage.close();
    subjectPage = await subjectContext.newPage();
    subjectPage.on('pageerror', error => errors.push(error.message));
    await login(subjectPage, email, fixture.password);
    expect((await subjectPage.request.get('/api/auth/me')).status()).toBe(200);
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    const userConfirm = page.getByRole('alertdialog', { name: 'Удалить пользователя?', exact: true });
    await userConfirm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(userConfirm).toHaveCount(0);
    expect(await user()).toBeDefined();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    const deletedUserResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/users' && response.request().method() === 'DELETE');
    await userConfirm.getByRole('button', { name: 'Удалить', exact: true }).click();
    const deletedUser = await deletedUserResponse;
    expect(deletedUser.status(), await deletedUser.text()).toBe(200);
    await expect(userConfirm).toHaveCount(0);
    expect(await user()).toBeUndefined();
    expect((await subjectPage.request.get('/api/auth/me')).status()).toBe(401);
    const audit = (await db.query('SELECT action,"actorId",metadata FROM "FeedbackEvent" WHERE scope=$1 AND "targetId"=$2 ORDER BY "createdAt",id', ['users', userId])).rows;
    expect(audit.map(row => row.action)).toEqual(['user.created', 'user.updated', 'user.document.created', 'user.document.updated', 'user.document.deleted', 'user.updated', 'user.updated', 'user.deleted']);
    expect(audit.every(row => row.actorId === fixture.users.ADMIN.id)).toBe(true);
    expect(audit[3].metadata.before.expiresAt.slice(0, 10)).toBe(offsetDate(-1));
    expect(audit[3].metadata.expiresAt.slice(0, 10)).toBe(offsetDate(90));
    expect(audit[3].metadata.documentId).toBe(documentId);
    observations.push({ step: 'document deleted; block revokes old session; unblock and login; confirmed user deletion', userId, documentId, audit });
    await page.screenshot({ path: info.outputPath('user-deleted.png'), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await info.attach('user-document-lifecycle', { body: JSON.stringify({ observations, errors }, null, 2), contentType: 'application/json' });
    await subjectContext.close();
    await db.end();
  }
});
