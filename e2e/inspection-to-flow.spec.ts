import { test, expect, type Page } from '@playwright/test';

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

/**
 * Логин с защитой от гонки гидрации: fill до монтирования React стирается
 * при гидрации (контролируемые инпуты), поэтому заполняем с проверкой
 * значения и ретраем, а вместо слепого таймаута ждём ответ /api/auth/login.
 */
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/');
  const email = page.locator('#email');
  const password = page.locator('#password');
  await email.waitFor({ state: 'visible', timeout: 10000 });

  // До гидрации клик по submit делает нативный сабмит формы (страница
  // перезагружается, поля очищаются, /api/auth/login не вызывается),
  // поэтому ретраим связку целиком, пока не увидим ответ API.
  await expect(async () => {
    await email.fill('admin@piling.ru');
    await password.fill('admin123');
    const respPromise = page
      .waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 4000 })
      .catch(() => null);
    await page.locator('button[type="submit"]').click();
    const resp = await respPromise;
    expect(resp, 'submit ушёл до гидрации — /api/auth/login не вызван').not.toBeNull();
    expect(resp!.ok()).toBe(true);
  }).toPass({ timeout: 30000, intervals: [1000, 2000, 3000] });

  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
}

test.describe('Inspection (ТО) flow', () => {
  test('admin starts ТО-1, answers an item and saves a draft', async ({ page }) => {
    // 1. Login (no networkidle — SSE keeps the network busy; see report-creation-flow)
    await loginAsAdmin(page);

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
    await loginAsAdmin(page);

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
