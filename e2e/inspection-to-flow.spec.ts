import { TEST_USERS } from './fixtures/auth.fixture';
import { test, expect } from './fixtures/disposable.fixture';
import { login } from './page-objects/login.page';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';

test('J9 inactive equipment preserves history without a current ready verdict', async ({ page }) => {
  test.skip(!process.env.INTEGRATION_DATABASE_URL_OWNER, 'Requires owned disposable PostgreSQL');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/codex_test'
    || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw new Error('Owned stand required');
  const db = new Client({ connectionString: url.toString() });
  const id = randomUUID();
  const name = 'J9 inactive ' + id;
  const snapshotId = randomUUID();
  const ruleSetId = randomUUID();
  const at = '2026-08-10T12:00:00.000Z';
  const facts = { inspectionCompleted: true, inspectionProgress: 1, healthScore: 100,
    meterKnown: true, permitValid: true, permitExpired: false, maintenanceConfigured: true,
    maintenanceOverdueHours: 0, maintenanceOverdueDays: 0, accepted: true, criticalDefect: false, findings: 0 };
  await db.connect();
  try {
    await db.query('INSERT INTO "Equipment" (id,"tenantId",name,"isActive","updatedAt") VALUES ($1,$2,$3,false,now())', [id, 'codex-e1-a', name]);
    await db.query('INSERT INTO "ReadinessRuleSet" (id,"tenantId",status,version,criteria,blockers,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())', [ruleSetId, 'codex-e1-a', 'ARCHIVED', 'j9-fixture', '{}', '[]']);
    await db.query('INSERT INTO "ReadinessScoreSnapshot" (id,"tenantId","equipmentId","ruleSetVersion","triggerType","triggerId",status,verdict,score,blockers,warnings,evidence,facts,"factsHash","calculatedAt","ruleSetId") VALUES ($1,$2,$3,$4,$5,$1,$6,$7,75,$8,$8,$9,$10,$11,$12,$13)',
      [snapshotId, 'codex-e1-a', id, 'j9-fixture', 'INSPECTION_COMPLETED', 'READY', 'ALLOWED', '[]',
        JSON.stringify({ equipmentId: id, inspectionId: null, permitId: null, maintenanceRecordIds: [], evaluatedAt: at }),
        JSON.stringify(facts), Buffer.alloc(32, 1), at, ruleSetId]);
    await db.query('INSERT INTO "CurrentReadiness" ("tenantId","equipmentId","snapshotId",status,verdict,score,"calculatedAt","updatedAt") VALUES ($1,$2,$3,$4,$5,75,$6,now())', ['codex-e1-a', id, snapshotId, 'READY', 'ALLOWED', at]);
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
    const current = await page.request.get('/api/readiness/current?equipmentId=' + id);
    expect(current.status()).toBe(200);
    expect((await current.json()).data[0]).toMatchObject({ equipmentActive: false, snapshotId, calculatedAt: at });
    await page.goto('/admin/to?view=fleet&equipmentId=' + id);
    await expect(page.getByRole('table', { name: /Готовность установок/ })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Codex Woltman A' })).toBeVisible();
    // The current bootstrap already limits this screen to active equipment.
    // The inactive DTO remains explicitly flagged for other current readers.
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    const history = await page.request.get('/api/readiness/history?equipmentId=' + id);
    expect(history.status()).toBe(200);
    expect((await history.json()).data).toContainEqual(expect.objectContaining({ id: snapshotId, status: 'READY', score: 75, calculatedAt: at }));
    expect((await db.query('SELECT score,status,"calculatedAt" FROM "ReadinessScoreSnapshot" WHERE id=$1', [snapshotId])).rows[0])
      .toMatchObject({ score: 75, status: 'READY', calculatedAt: new Date(at) });
  } finally {
    // Immutable fixture history remains until the owned stand is removed.
    await db.end();
  }
});

/**
 * E2E — Проведение ТО (осмотра) end-to-end.
 *
 * Покрывает связку start-inspection-form → run-inspection:
 * 1. Логин администратором
 * 2. /inspections/new: выбор установки и уровня ТО-1
 * 3. Превью сборки чек-листа («✓ шаблон есть», без «нет шаблона»)
 *    + панель расходников «Заказать перед ТО»
 * 4. Старт осмотра → страница заполнения
 * 5. Ответ на первый пункт + примечание (компактный режим «+ замечание / фото»)
 * 6. Сохранение черновика → ответ переживает перезагрузку страницы
 *
 * Каждый прогон создаёт черновик осмотра в БД — для локальной/CI базы это
 * допустимо (черновики не влияют на аналитику).
 */

test.describe('Inspection (ТО) flow', () => {
  test('admin starts ТО-1, answers an item and saves a draft', async ({ page }) => {
    // 1. Login (hydration-safe shared helper; see page-objects/login.page.ts)
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);

    // 2. Start-inspection form
    await page.goto('/inspections/new');
    const equipmentSelect = page.locator('#si-equipment');
    await equipmentSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Pick the first equipment with a model-specific template (КБУРГ exists in seed)
    await equipmentSelect.click();
    const option = page.getByRole('option', { name: /КБУРГ|Woltman|Liebherr/i }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();

    // Level ТО-1
    await page.locator('#si-level').click();
    await page.getByRole('option', { name: /ТО-1/i }).first().click();
    await page.waitForTimeout(1200);

    // 3. Assembly preview: a template exists, nothing is missing
    const body = page.locator('body');
    await expect(body).toContainText('шаблон есть');
    await expect(body).not.toContainText('нет шаблона');
    // Consumables panel for ТО levels
    await expect(body).toContainText('Заказать перед ТО');

    // 4. Start the inspection
    await page.getByRole('button', { name: /Начать осмотр/i }).click();
    await page.waitForURL(/\/inspections\/(?!new)[\w-]+/, { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 5. Answer the first item. Templates use DONE checkboxes and YES_NO buttons;
    //    whichever renders first is fine — we just need one persisted answer.
    const doneCheckbox = page.locator('input[type="checkbox"]').first();
    const yesButton = page.getByRole('button', { name: 'Да', exact: true }).first();
    let answeredVia: 'checkbox' | 'yes';
    if (await doneCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await doneCheckbox.check();
      answeredVia = 'checkbox';
    } else {
      await yesButton.click();
      answeredVia = 'yes';
    }

    // Compact mode: note/photo are collapsed behind «+ замечание / фото»
    const noteToggle = page.getByText('+ замечание / фото').first();
    await expect(noteToggle).toBeVisible();
    await noteToggle.click();
    const note = page.locator('textarea').first();
    await note.fill('e2e: проверено автотестом');

    // 6. Save draft and verify persistence across reload. Assert the PUT
    // response (robust) instead of the toast (may auto-dismiss / animate).
    const [saveRes] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/inspections\/[\w-]+$/.test(r.url()) && r.request().method() === 'PUT',
        { timeout: 15000 },
      ),
      page.getByRole('button', { name: /Сохранить черновик/i }).click(),
    ]);
    expect(saveRes.ok(), `PUT draft failed: ${saveRes.status()}`).toBe(true);

    await page.reload();
    await page.waitForTimeout(2000);
    if (answeredVia === 'checkbox') {
      await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
    } else {
      // After reload the saved note auto-expands its item (non-empty note)
      await expect(page.locator('textarea').first()).toHaveValue('e2e: проверено автотестом');
    }
  });

  test('hammer block resolves to a template on ТО levels', async ({ page }) => {
    await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);

    await page.goto('/inspections/new');
    await page.locator('#si-equipment').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#si-equipment').click();
    // Woltman carries a hammer (hydraulic) in the seed data
    await page.getByRole('option', { name: /Woltman|PVE 50/i }).first().click();
    await page.locator('#si-level').click();
    await page.getByRole('option', { name: /ТО-3/i }).first().click();
    await page.waitForTimeout(1200);

    const body = page.locator('body');
    await expect(body).toContainText('Молот');
    await expect(body).not.toContainText('нет шаблона');
  });
});


test('mechanic: complete a composed inspection with a photo, audit, meters and readiness', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fixture = await createRoleAuditFixture();
  const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
  const observed: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await db.connect();
  try {
    // Two synthetic blocks exercise all four supported answer types.
    const baseId = randomUUID(), hammerId = randomUUID();
    const sections = [randomUUID(), randomUUID(), randomUUID()];
    const items = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [id, block, model, hammer] of [[baseId, 'BASE', 'КБУРГ', null], [hammerId, 'HAMMER', null, 'HYDRAULIC']]) {
      await db.query('INSERT INTO "ChecklistTemplate" (id,"tenantId",name,level,"blockType","appliesToModel","appliesToHammerKind","createdById","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())',
        [id, fixture.tenantId, 'QA mechanic ' + block, 'EO', block, model, hammer, fixture.users.ADMIN.id]);
    }
    for (const [i, title] of ['QA hydraulic checks', 'QA measurements', 'QA hammer checks'].entries()) {
      await db.query('INSERT INTO "ChecklistSection" (id,"tenantId","templateId",title,"order") VALUES ($1,$2,$3,$4,$5)',
        [sections[i], fixture.tenantId, i === 2 ? hammerId : baseId, title, i]);
    }
    const texts = ['QA photo of hydraulic unit', 'QA hydraulic condition', 'QA lubrication done', 'QA pressure measurement', 'QA hammer secured'];
    const kinds = ['YES_NO', 'STATUS4', 'DONE', 'MEASURE', 'YES_NO'];
    for (const [i, text] of texts.entries()) {
      await db.query('INSERT INTO "ChecklistItem" (id,"tenantId","sectionId",text,"answerType","photoRequired","order") VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [items[i], fixture.tenantId, sections[i < 2 ? 0 : i < 4 ? 1 : 2], text, kinds[i], i === 0, i]);
    }
    await login(page, fixture.users.MECHANIC.email, fixture.password);
    await page.goto('/inspections/new?equipmentId=' + fixture.equipmentId);
    await expect(page.locator('#si-equipment')).toContainText('QA КБУРГ');
    await expect(page.locator('body')).toContainText('База · КБУРГ');
    await expect(page.locator('body')).toContainText('Молот · гидравлический');
    await expect(page.getByText('✓ шаблон есть', { exact: true })).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText('нет шаблона');
    await page.locator('#si-hours').fill('101');
    const started = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inspections' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Начать осмотр', exact: true }).click();
    expect((await started).status()).toBe(201);
    await expect(page).toHaveURL(/\/inspections\/[^/?]+$/);
    const id = new URL(page.url()).pathname.slice('/inspections/'.length);
    expect(id).not.toBe('');
    const initial = (await db.query('SELECT i.status,i."performedById",i."maintenanceRecordId",m.status AS "maintenanceStatus",m."createdById" FROM "Inspection" i JOIN "MaintenanceRecord" m ON m.id=i."maintenanceRecordId" WHERE i.id=$1 AND i."tenantId"=$2', [id, fixture.tenantId])).rows[0];
    expect(initial).toMatchObject({ status: 'DRAFT', performedById: fixture.users.MECHANIC.id, maintenanceStatus: 'IN_PROGRESS', createdById: fixture.users.MECHANIC.id });
    const item = (text: string) => page.locator('div.rounded-lg.border.bg-card.px-3.py-3').filter({ hasText: text });
    const photo = item(texts[0]);
    await photo.getByRole('button', { name: 'Да', exact: true }).click();
    const note = 'Синтетический осмотр: гидравлика проверена на тестовых данных.';
    await photo.getByPlaceholder('Примечание…', { exact: true }).fill(note);
    await item(texts[1]).getByRole('button', { name: 'Исправно', exact: true }).click();
    const save = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inspections/' + id && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    expect((await save).status()).toBe(200);
    expect((await db.query('SELECT result,note FROM "InspectionAnswer" WHERE "inspectionId"=$1 AND "itemId"=$2', [id, items[0]])).rows).toEqual([{ result: 'YES', note }]);
    await page.reload();
    await expect(item(texts[0]).getByPlaceholder('Примечание…', { exact: true })).toHaveValue(note);
    const image = await item(texts[0]).screenshot();
    const confirm = page.waitForResponse(r => /\/api\/media\/[^/]+\/confirm$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await item(texts[0]).locator('input[type="file"]').setInputFiles({ name: 'night-inspection.png', mimeType: 'image/png', buffer: image });
    expect((await confirm).status()).toBe(200);
    await expect(item(texts[0]).getByRole('button', { name: 'Открыть фото', exact: true })).toBeVisible();
    const media = (await db.query('SELECT id,"uploadStatus","userId","fileSize" FROM "Media" WHERE "tenantId"=$1 AND "entityId"=$2 AND "isDeleted"=false', [fixture.tenantId, id + '__' + items[0]])).rows;
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ uploadStatus: 'completed', userId: fixture.users.MECHANIC.id, fileSize: image.length });
    const download = await page.request.get('/api/media/' + media[0].id + '/download');
    expect(download.status()).toBe(200);
    const bytes = await page.request.get((await download.json()).url);
    expect(bytes.status()).toBe(200);
    expect(await bytes.body()).toEqual(image);
    let next = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inspections/' + id && r.request().method() === 'PUT');
    await page.getByRole('button', { name: /^Далее:/ }).click();
    expect((await next).status()).toBe(200);
    await item(texts[2]).getByRole('checkbox').check();
    await item(texts[3]).getByPlaceholder('Значение', { exact: true }).fill('12');
    next = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inspections/' + id && r.request().method() === 'PUT');
    await page.getByRole('button', { name: /^Далее:/ }).click();
    expect((await next).status()).toBe(200);
    await item(texts[4]).getByRole('button', { name: 'Да', exact: true }).click();
    await page.getByRole('button', { name: 'Завершить осмотр', exact: true }).click();
    await page.getByLabel('Подписал', { exact: true }).fill('QA MECHANIC');
    const completed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/inspections/' + id + '/complete' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    expect((await completed).status()).toBe(200);
    await expect(page).toHaveURL(/\/inspections$/);
    const result = (await db.query('SELECT i.status,i."performedById",i."signedByName",i."signedAt",i."healthScore",m.status AS "maintenanceStatus",e."engineHoursTotal" FROM "Inspection" i JOIN "MaintenanceRecord" m ON m.id=i."maintenanceRecordId" JOIN "Equipment" e ON e.id=i."equipmentId" WHERE i.id=$1 AND i."tenantId"=$2', [id, fixture.tenantId])).rows[0];
    expect(result).toMatchObject({ status: 'COMPLETED', performedById: fixture.users.MECHANIC.id, signedByName: 'QA MECHANIC', healthScore: 100, maintenanceStatus: 'DONE', engineHoursTotal: 101 });
    expect(result.signedAt).toBeInstanceOf(Date);
    const readings = (await db.query('SELECT id,"engineHours",source,"recordedById",note FROM "MeterReading" WHERE "tenantId"=$1 AND "equipmentId"=$2 ORDER BY id', [fixture.tenantId, fixture.equipmentId])).rows;
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ engineHours: 101, source: 'MANUAL', recordedById: fixture.users.MECHANIC.id, note: 'Снято при осмотре EO' });
    const answers = (await db.query('SELECT "itemId",result,value,note,"photoCount" FROM "InspectionAnswer" WHERE "inspectionId"=$1 ORDER BY "itemId"', [id])).rows;
    expect(answers).toHaveLength(5);
    for (const [i, answer] of ['YES', 'OK', 'DONE', 'OK', 'YES'].entries()) expect(answers).toContainEqual(expect.objectContaining({ itemId: items[i], result: answer }));
    expect(answers).toContainEqual(expect.objectContaining({ itemId: items[0], note, photoCount: 1 }));
    expect(answers).toContainEqual(expect.objectContaining({ itemId: items[3], value: '12' }));
    const audit = (await db.query('SELECT action,"actorId" FROM "FeedbackEvent" WHERE "targetId"=$1 AND action IN ($2,$3)', [id, 'inspection.started', 'inspection.completed'])).rows;
    expect(audit).toEqual(expect.arrayContaining([{ action: 'inspection.started', actorId: fixture.users.MECHANIC.id }, { action: 'inspection.completed', actorId: fixture.users.MECHANIC.id }]));
    expect(audit).toHaveLength(2);
    await expect.poll(async () => Number((await db.query('SELECT count(*) FROM "ReadinessScoreSnapshot" WHERE "tenantId"=$1 AND "equipmentId"=$2 AND "triggerType"=$3 AND "triggerId"=$4', [fixture.tenantId, fixture.equipmentId, 'INSPECTION_COMPLETED', id + ':completed'])).rows[0].count), { timeout: 30_000 }).toBe(1);
    const snapshot = (await db.query('SELECT id,facts,evidence FROM "ReadinessScoreSnapshot" WHERE "tenantId"=$1 AND "equipmentId"=$2 AND "triggerType"=$3 AND "triggerId"=$4', [fixture.tenantId, fixture.equipmentId, 'INSPECTION_COMPLETED', id + ':completed'])).rows[0];
    expect(snapshot.facts).toMatchObject({ inspectionCompleted: true, healthScore: 100, meterKnown: true });
    expect(snapshot.evidence.inspectionId).toBe(id);
    expect(snapshot.evidence.maintenanceRecordIds).not.toContain(initial.maintenanceRecordId);
    await page.goto('/inspections/' + id);
    await expect(page.getByRole('button', { name: 'Сохранить черновик', exact: true })).toHaveCount(0);
    await expect(item(texts[0]).getByRole('button', { name: 'Да', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('mechanic-completed-inspection.png'), fullPage: true });
    const replay = await page.request.post('/api/inspections/' + id + '/complete', { headers: { Origin: new URL(page.url()).origin }, data: { signedByName: 'replay must preserve original signature' } });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).inspection.signedByName).toBe('QA MECHANIC');
    expect((await db.query('SELECT id,"engineHours",source,"recordedById",note FROM "MeterReading" WHERE "tenantId"=$1 AND "equipmentId"=$2 ORDER BY id', [fixture.tenantId, fixture.equipmentId])).rows).toEqual(readings);
    expect((await db.query('SELECT "signedAt" FROM "Inspection" WHERE id=$1', [id])).rows).toEqual([{ signedAt: result.signedAt }]);
    expect(Number((await db.query('SELECT count(*) FROM "FeedbackEvent" WHERE "targetId"=$1 AND action=$2', [id, 'inspection.completed'])).rows[0].count)).toBe(1);
    for (const role of ['DISPATCHER', 'OPERATOR', 'ASSISTANT'] as const) {
      const context = page.context();
      const logout = await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
      expect(logout.status()).toBe(200);
      // Close the old authenticated shell before logging in again: its session
      // probe can redirect to /login concurrently with the shared login helper.
      await page.close();
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await login(page, fixture.users[role].email, fixture.password);
      const read = await page.request.get('/api/inspections/' + id);
      expect(read.status(), role + ' inspection access').toBe(role === 'DISPATCHER' ? 200 : role === 'OPERATOR' ? 404 : 403);
      if (role === 'DISPATCHER') {
        expect((await read.json()).inspection).toMatchObject({ id, status: 'COMPLETED', performedById: fixture.users.MECHANIC.id });
        await page.goto('/inspections/' + id);
        await expect(page.getByText('Завершён', { exact: true })).toBeVisible();
        await expect(item(texts[0]).getByPlaceholder('Примечание…', { exact: true })).toHaveValue(note);
        await page.screenshot({ path: info.outputPath('dispatcher-mechanic-inspection.png'), fullPage: true });
      }
      if (role === 'OPERATOR' || role === 'ASSISTANT') {
        await page.goto('/inspections/' + id);
        await expect(page.locator('body')).toContainText(role === 'OPERATOR' ? 'Осмотр не найден или принадлежит другому оператору.' : /Нет прав на просмотр осмотра|Нет доступа/);
        await expect(page.locator('body')).not.toContainText(note);
        await page.screenshot({ path: info.outputPath(role + '-inspection-denied.png'), fullPage: true });
      }
      observed.push({ step: 'cross-role read', role, status: read.status() });
    }
    expect(errors).toEqual([]);
    observed.push({ step: 'mechanic inspection completed', inspectionId: id, equipmentId: fixture.equipmentId, maintenanceRecordId: initial.maintenanceRecordId, snapshotId: snapshot.id, mediaId: media[0].id, readings, answers, audit });
  } finally {
    await db.end();
    await info.attach('mechanic-inspection', { body: JSON.stringify({ observed, errors }), contentType: 'application/json' });
  }
});
