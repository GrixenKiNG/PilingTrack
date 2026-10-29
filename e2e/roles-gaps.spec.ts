import { test, expect } from './fixtures/disposable.fixture';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { login } from './page-objects/login.page';
import { Client } from 'pg';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { getTodayInTimezone } from '../src/lib/timezone';
import { EquipmentDocumentType } from '../src/generated/postgres-client/enums';

async function ownedSql() {
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test' || url.username !== 'piling'
    || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw Error('Owned disposable PG required');
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  return db;
}

async function browserFetch(page: Page, url: string, method = 'GET', data?: unknown) {
  return page.evaluate(async ({ url, method, data }) => {
    const response = await fetch(url, {
      method, credentials: 'same-origin',
      ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    });
    return { status: response.status, text: await response.text() };
  }, { url, method, data });
}

async function newDeviceContext(browser: Browser, info: TestInfo) {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile,
    hasTouch: use.hasTouch, ignoreHTTPSErrors: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    extraHTTPHeaders: { 'x-forwarded-for': `127.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}` },
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.abort('blockedbyclient');
    else await route.continue();
  });
  return context;
}

function dateOffset(days: number) {
  const date = new Date(getTodayInTimezone() + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('roles gaps: administrator resets password, revokes old session and new UI login works', async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const fixture = await createRoleAuditFixture();
  const db = await ownedSql();
  const oldContext = await newDeviceContext(browser, info);
  const newContext = await newDeviceContext(browser, info);
  const rejectedContext = await newDeviceContext(browser, info);
  const subject = fixture.users.OPERATOR;
  const password = randomUUID() + '-Aa8!';
  const observations: Array<Record<string, unknown>> = [];
  try {
    const oldPage = await oldContext.newPage();
    await login(oldPage, subject.email, fixture.password);
    expect((await oldContext.request.get('/api/auth/me')).status()).toBe(200);
    // Stop the page's polling while retaining its original, unmodified session cookie.
    await oldPage.close();
    const before = (await db.query('SELECT "sessionVersion" FROM "User" WHERE id=$1 AND "tenantId"=$2', [subject.id, fixture.tenantId])).rows[0];
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await page.goto('/admin/users');
    await page.getByPlaceholder('ФИО, email или телефон').fill(subject.email);
    await page.getByRole('button').filter({ has: page.getByText(subject.email, { exact: true }) }).click();
    await page.getByRole('tab', { name: 'Доступ', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать пользователя', exact: true });
    await dialog.locator('label').filter({ hasText: 'Новый пароль (оставьте пустым, чтобы не менять)' }).locator('..').locator('input').fill(password);
    const resetting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/users' && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const reset = await resetting;
    expect(reset.status(), await reset.text()).toBe(200);
    await expect(dialog).toHaveCount(0);
    const after = (await db.query('SELECT "sessionVersion" FROM "User" WHERE id=$1 AND "tenantId"=$2', [subject.id, fixture.tenantId])).rows[0];
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    const oldSession = await oldContext.request.get('/api/auth/me');
    expect(oldSession.status()).toBe(401);
    const newPage = await newContext.newPage();
    await login(newPage, subject.email, password);
    const me = await browserFetch(newPage, '/api/auth/me');
    expect(me.status).toBe(200);
    expect(JSON.parse(me.text).user.id).toBe(subject.id);
    const rejectedPage = await rejectedContext.newPage();
    await rejectedPage.goto('/login');
    const rejected = await browserFetch(rejectedPage, '/api/auth/login', 'POST', { email: subject.email, password: fixture.password });
    expect(rejected.status).toBe(401);
    const audit = (await db.query('SELECT action,"actorId","targetId" FROM "FeedbackEvent" WHERE "targetId"=$1 AND action=$2 ORDER BY "createdAt"', [subject.id, 'user.updated'])).rows;
    expect(audit).toContainEqual({ action: 'user.updated', actorId: fixture.users.ADMIN.id, targetId: subject.id });
    observations.push({ userId: subject.id, before, after, reset: reset.status(), oldSession: oldSession.status(), newSession: me.status, oldPassword: rejected.status, audit });
  } finally {
    await info.attach('password-reset-proof', { body: JSON.stringify(observations), contentType: 'application/json' });
    await Promise.all([oldContext.close(), newContext.close(), rejectedContext.close()]);
    await db.end();
  }
});

test('roles gaps: every configured personnel document type reaches missing, valid, expiring and expired controls', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const fixture = await createRoleAuditFixture();
  const db = await ownedSql();
  const context = await newDeviceContext(browser, info);
  const operator = await context.newPage();
  const observations: Array<Record<string, unknown>> = [];
  try {
    await login(page, fixture.users.ADMIN.email, fixture.password);
    const seed = readFileSync('scripts/seed-user-document-types.ts', 'utf8');
    // Read the catalogue as data; never execute its dotenv/DB entrypoint.
    const catalogue = [...seed.matchAll(/name:\s*'([^']+)'\s*,\s*defaultValidMonths:\s*(\d+|null)\s*,\s*leadTimeDays:\s*(\d+)/g)].map(m => ({ name: m[1], defaultValidMonths: m[2] === 'null' ? null : Number(m[2]), leadTimeDays: Number(m[3]), requiresExpiry: m[2] !== 'null' }));
    expect(catalogue).toHaveLength(7);
    catalogue.push({ name: 'QA бессрочное удостоверение', defaultValidMonths: null, leadTimeDays: 7, requiresExpiry: false });
    const types: Array<{ id: string; name: string; requiresExpiry: boolean }> = [];
    for (const entry of catalogue) {
      const created = await browserFetch(page, '/api/user-document-types', 'POST', { ...entry, requiredForOperator: true });
      expect(created.status, created.text).toBe(201);
      types.push(JSON.parse(created.text).type);
    }
    const listed = await browserFetch(page, '/api/user-document-types');
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.text).types.map((t: { id: string }) => t.id).sort()).toEqual(types.map(t => t.id).sort());
    await login(operator, fixture.users.OPERATOR.email, fixture.password);
    const checks = async () => {
      const response = await browserFetch(operator, '/api/operator/mobile/state');
      expect(response.status, response.text).toBe(200);
      return JSON.parse(response.text).data.identity.documents as Array<{ typeId: string; verdict: string; required: boolean }>;
    };
    const control = async () => {
      const response = await browserFetch(page, '/api/user-documents/control');
      expect(response.status, response.text).toBe(200);
      return JSON.parse(response.text) as { documents: Array<{ typeId: string; userId: string; expiry: { status: string } }>; expired: number; expiring: number };
    };
    for (const type of types) expect((await checks()).find(t => t.typeId === type.id)).toEqual(expect.objectContaining({ required: true, verdict: 'MISSING' }));
    const held = new Map<string, string>();
    for (const type of types) {
      const created = await browserFetch(page, '/api/users/' + fixture.users.OPERATOR.id + '/documents', 'POST', {
        typeId: type.id, number: 'QA-' + randomUUID(), issuedAt: dateOffset(-730), expiresAt: type.requiresExpiry ? dateOffset(90) : null,
      });
      expect(created.status, created.text).toBe(201);
      held.set(type.id, JSON.parse(created.text).document.id);
    }
    for (const type of types) expect((await checks()).find(t => t.typeId === type.id)?.verdict).toBe('VALID');
    expect((await control()).documents).toEqual([]);
    for (const type of types.filter(t => t.requiresExpiry)) {
      const id = held.get(type.id);
      const url = '/api/users/' + fixture.users.OPERATOR.id + '/documents/' + id;
      const update = async (days: number) => {
        const response = await browserFetch(page, url, 'PUT', { expiresAt: dateOffset(days) });
        expect(response.status, response.text).toBe(200);
        const row = (await db.query('SELECT "typeId","expiresAt" FROM "UserDocument" WHERE id=$1 AND "tenantId"=$2', [id, fixture.tenantId])).rows[0];
        expect(row.typeId).toBe(type.id);
        expect(row.expiresAt.toISOString().slice(0, 10)).toBe(dateOffset(days));
        return row;
      };
      const expiredSql = await update(-1);
      expect((await checks()).find(t => t.typeId === type.id)?.verdict).toBe('EXPIRED');
      const expired = await control();
      expect(expired.expired).toBe(1);
      expect(expired.documents).toEqual([expect.objectContaining({ typeId: type.id, userId: fixture.users.OPERATOR.id, expiry: expect.objectContaining({ status: 'expired' }) })]);
      const soonSql = await update(2);
      expect((await checks()).find(t => t.typeId === type.id)?.verdict).toBe('EXPIRING');
      const soon = await control();
      expect(soon.expired).toBe(0);
      expect(soon.expiring).toBe(1);
      expect(soon.documents).toEqual([expect.objectContaining({ typeId: type.id, expiry: expect.objectContaining({ status: 'expiring' }) })]);
      const restoredSql = await update(90);
      expect((await checks()).find(t => t.typeId === type.id)?.verdict).toBe('VALID');
      expect((await control()).documents).toEqual([]);
      observations.push({ type, expiredSql, soonSql, restoredSql, expired, soon });
    }
    const permanent = types.find(t => !t.requiresExpiry);
    expect(permanent).toBeTruthy();
    const rows = (await db.query('SELECT "typeId","expiresAt" FROM "UserDocument" WHERE "userId"=$1 AND "tenantId"=$2 ORDER BY "typeId"', [fixture.users.OPERATOR.id, fixture.tenantId])).rows;
    expect(rows).toHaveLength(types.length);
    expect(rows.find(row => row.typeId === permanent?.id).expiresAt).toBeNull();
    observations.push({ step: 'all restored, including permanent type', checks: await checks(), rows, control: await control() });
  } finally {
    await info.attach('personnel-catalogue-proof', { body: JSON.stringify(observations), contentType: 'application/json' });
    await context.close();
    await db.end();
  }
});

test('roles gaps: all seven equipment document kinds persist expiry and remain distinct from personnel controls', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  const fixture = await createRoleAuditFixture();
  const db = await ownedSql();
  const context = await newDeviceContext(browser, info);
  const operator = await context.newPage();
  const labels = { PASSPORT: 'Паспорт', OTS: 'ОТС', INSURANCE: 'Страховка', INSPECTION: 'Тех. осмотр', CERTIFICATE: 'Сертификат', MAINTENANCE_LOG: 'Журнал ТО', OTHER: 'Прочее' };
  expect(Object.keys(labels).sort()).toEqual(Object.values(EquipmentDocumentType).sort());
  const observations: Array<Record<string, unknown>> = [];
  try {
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await login(operator, fixture.users.OPERATOR.email, fixture.password);
    const personnelState = async () => {
      const state = await browserFetch(operator, '/api/operator/mobile/state');
      expect(state.status, state.text).toBe(200);
      const response = await browserFetch(page, '/api/user-documents/control');
      expect(response.status).toBe(200);
      return { checks: JSON.parse(state.text).data.identity.documents, control: JSON.parse(response.text) };
    };
    const before = await personnelState();
    await page.goto('/admin/equipment/' + fixture.equipmentId + '#documents');
    const collection = '/api/equipment/' + fixture.equipmentId + '/documents';
    for (const [type, label] of Object.entries(labels)) {
      const title = 'QA ' + type + ' ' + randomUUID();
      await page.locator('#documents').getByRole('button', { name: 'Добавить', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: 'Новый документ', exact: true });
      await dialog.getByRole('combobox', { name: 'Тип', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await dialog.getByLabel('Название *', { exact: true }).fill(title);
      await dialog.getByLabel('Выдан', { exact: true }).fill('2020-01-01');
      await dialog.getByLabel('Действует до', { exact: true }).fill('2020-01-02');
      const creating = page.waitForResponse(r => new URL(r.url()).pathname === collection && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
      const created = await creating;
      expect(created.status(), await created.text()).toBe(201);
      const id = (await created.json()).document.id as string;
      await expect(dialog).toHaveCount(0);
      const row = page.locator('#documents li').filter({ hasText: title });
      await expect(row.getByText(label, { exact: true })).toBeVisible();
      await expect(row.getByText(/^Истёк /)).toBeVisible();
      const stored = (await db.query('SELECT id,type,title,"expiresAt" FROM "EquipmentDocument" WHERE id=$1 AND "tenantId"=$2 AND "equipmentId"=$3', [id, fixture.tenantId, fixture.equipmentId])).rows[0];
      expect(stored.type).toBe(type);
      expect(stored.expiresAt.toISOString().slice(0, 10)).toBe('2020-01-02');
      expect(await personnelState()).toEqual(before);
      await row.getByRole('button', { name: 'Редактировать документ «' + title + '»', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Редактировать документ', exact: true });
      await dialog.getByLabel('Действует до', { exact: true }).fill(dateOffset(90));
      const saving = page.waitForResponse(r => new URL(r.url()).pathname === collection + '/' + id && r.request().method() === 'PUT');
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
      expect((await saving).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await expect(row.getByText(/^Истёк /)).toHaveCount(0);
      const extended = (await db.query('SELECT "expiresAt" FROM "EquipmentDocument" WHERE id=$1 AND "tenantId"=$2', [id, fixture.tenantId])).rows[0];
      expect(extended.expiresAt.toISOString().slice(0, 10)).toBe(dateOffset(90));
      observations.push({ type, id, stored, extended });
    }
    await page.reload();
    await expect(page.locator('#documents li')).toHaveCount(7);
    expect(await personnelState()).toEqual(before);
    await page.screenshot({ path: info.outputPath('all-equipment-document-kinds.png'), fullPage: true });
  } finally {
    await info.attach('equipment-catalogue-proof', { body: JSON.stringify(observations), contentType: 'application/json' });
    await context.close();
    await db.end();
  }
});

for (const role of ['OPERATOR', 'MECHANIC', 'DISPATCHER'] as const) {
  test('roles gaps: ' + role + ' rejects foreign ids on twelve sensitive routes without SQL changes', async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const fixture = await createRoleAuditFixture();
    const other = await createRoleAuditFixture();
    const db = await ownedSql();
    const context = await newDeviceContext(browser, info);
    const owner = await context.newPage();
    const ids = { maintenance: randomUUID(), template: randomUUID(), inspection: randomUUID(), briefing: randomUUID(), type: randomUUID(), document: randomUUID(), equipmentDocument: randomUUID() };
    const observations: Array<Record<string, unknown>> = [];
    try {
      await db.query('INSERT INTO "MaintenanceRecord" (id,"tenantId","equipmentId",type,title,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [ids.maintenance, other.tenantId, other.equipmentId, 'REPAIR', 'QA foreign maintenance']);
      await db.query('INSERT INTO "ChecklistTemplate" (id,"tenantId",name,level,"updatedAt") VALUES ($1,$2,$3,$4,now())', [ids.template, other.tenantId, 'QA foreign template', 'EO']);
      await db.query('INSERT INTO "Inspection" (id,"tenantId","equipmentId","templateId",level,"performedById","inspectionDate","templateSnapshot","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now(),$7::jsonb,now())', [ids.inspection, other.tenantId, other.equipmentId, ids.template, 'EO', other.users.OPERATOR.id, JSON.stringify({ sections: [] })]);
      await db.query('INSERT INTO "BriefingRecord" (id,"tenantId","userId",kind,"userName","userRole","documentCode","documentTitle","documentVersion","recordedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8,now())', [ids.briefing, other.tenantId, other.users.OPERATOR.id, 'INSTRUCTION', 'QA foreign briefing', 'OPERATOR', 'QA-FOREIGN', '1']);
      await db.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","updatedAt") VALUES ($1,$2,$3,$4,now())', [ids.type, other.tenantId, 'QA foreign credential', 'qa foreign credential']);
      await db.query('INSERT INTO "UserDocument" (id,"tenantId","userId","typeId",number,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [ids.document, other.tenantId, other.users.OPERATOR.id, ids.type, 'QA-FOREIGN']);
      await db.query('INSERT INTO "EquipmentDocument" (id,"tenantId","equipmentId",type,title,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [ids.equipmentDocument, other.tenantId, other.equipmentId, 'PASSPORT', 'QA foreign passport']);
      const eq = '/api/equipment/' + other.equipmentId;
      const user = '/api/users/' + other.users.OPERATOR.id + '/documents';
      const requests: Array<{ url: string; method: string; data?: unknown }> = [
        { url: eq, method: 'GET' },
        { url: eq + '/details', method: 'GET' },
        { url: eq + '/device-keys', method: 'GET' },
        { url: eq + '/documents/' + ids.equipmentDocument, method: 'PUT', data: { title: 'FORBIDDEN' } },
        { url: '/api/maintenance/' + ids.maintenance, method: 'GET' },
        { url: '/api/inspections/' + ids.inspection, method: 'GET' },
        { url: '/api/checklist-templates/' + ids.template, method: 'GET' },
        { url: user, method: 'GET' },
        { url: user + '/' + ids.document, method: 'PUT', data: { number: 'FORBIDDEN' } },
        { url: '/api/briefings/' + ids.briefing + '/sign', method: 'POST', data: {} },
        { url: '/api/sites/' + other.siteId, method: 'PUT', data: { name: 'FORBIDDEN' } },
        { url: '/api/crews/' + other.crewId, method: 'PUT', data: { name: 'FORBIDDEN' } },
      ];
      // Existing target ids are verified through their own tenant's real admin session.
      await login(owner, other.users.ADMIN.email, other.password);
      for (const request of requests.filter(r => r.method === 'GET')) {
        const response = await browserFetch(owner, request.url);
        observations.push({ phase: 'positive owner control', url: request.url, status: response.status });
        expect(response.status, response.text).toBe(200);
      }
      await context.close();
      const snapshot = async () => {
        const rows: Record<string, unknown> = {};
        for (const [table, id] of [['Equipment', other.equipmentId], ['Site', other.siteId], ['Crew', other.crewId], ['MaintenanceRecord', ids.maintenance], ['ChecklistTemplate', ids.template], ['Inspection', ids.inspection], ['BriefingRecord', ids.briefing], ['UserDocument', ids.document], ['EquipmentDocument', ids.equipmentDocument]]) {
          rows[table] = (await db.query('SELECT to_jsonb(t) AS row FROM "' + table + '" t WHERE id=$1', [id])).rows[0]?.row;
          expect(rows[table], table + ' fixture exists').toBeTruthy();
        }
        return rows;
      };
      await login(page, fixture.users[role].email, fixture.password);
      const before = await snapshot();
      for (const request of requests) {
        const response = await browserFetch(page, request.url, request.method, request.data);
        const after = await snapshot();
        observations.push({ phase: 'foreign id', role, ...request, ...response, unchanged: JSON.stringify(after) === JSON.stringify(before) });
        expect.soft([403, 404], request.method + ' ' + request.url + ' ' + response.text).toContain(response.status);
        expect.soft(after, request.method + ' ' + request.url + ' SQL').toEqual(before);
      }
      observations.push({ phase: 'final business rows', before, after: await snapshot() });
    } finally {
      await info.attach('foreign-id-proof', { body: JSON.stringify(observations), contentType: 'application/json' });
      await context.close();
      await db.end();
    }
  });
}
