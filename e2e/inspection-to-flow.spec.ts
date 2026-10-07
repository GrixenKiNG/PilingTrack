import { TEST_USERS } from './fixtures/auth.fixture';
import { test, expect } from './fixtures/disposable.fixture';
import { login } from './page-objects/login.page';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

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
