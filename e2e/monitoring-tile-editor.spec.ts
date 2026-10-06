import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { Client } from 'pg';
import { expect, test } from './fixtures/disposable.fixture';
import { login } from './page-objects/login.page';

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

test.describe('monitoring equipment tile editor', () => {
  test('applies one layout with a different photo for every installation', async ({ page }, testInfo) => {
    test.skip(!['chromium', 'Mobile Chrome'].includes(testInfo.project.name));

    test.skip(process.env.E2E_S3_READY !== 'true', 'Requires verified disposable S3');
    const fixture = await createRoleAuditFixture();
    const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
    await db.connect();
    try { await db.query('INSERT INTO "Equipment" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [fixture.equipmentId + '-second', fixture.tenantId, 'QA second rig']); }
    finally { await db.end(); }
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await page.evaluate(async () => {
      localStorage.removeItem('monitoring-equipment-tile-template-v1');
      localStorage.removeItem('monitoring-equipment-tile-template-v1-migrated');
      localStorage.removeItem('monitoring-design-unlocked');
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('monitoring-equipment-tile-assets-v1');
        request.addEventListener('success', () => resolve(), { once: true });
        request.addEventListener('error', () => resolve(), { once: true });
        request.addEventListener('blocked', () => resolve(), { once: true });
      });
    });
    if (testInfo.project.name === 'Mobile Chrome') {
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await page.goto('/admin/settings');
    await page.getByRole('button', { name: 'Шаблоны плиток', exact: true }).click();

    const editButton = page.getByRole('button', { name: 'Открыть редактор плиток' });
    await expect(editButton).toBeVisible();
    await editButton.click();
    await expect(page.getByRole('dialog', { name: 'Редактор шаблона плитки' })).toBeVisible();

    if (testInfo.project.name === 'Mobile Chrome') {
      await page.getByRole('button', { name: 'Блоки' }).click();
    }
    await page.getByRole('button', { name: 'Добавить текст' }).click();
    const textInput = page.getByLabel('Текст блока');
    await textInput.fill('Проверка общего шаблона');
    await page.getByLabel('Размер шрифта').fill('18');
    await page.getByLabel('Выравнивание текста').selectOption('center');

    if (testInfo.project.name === 'Mobile Chrome') {
      await page.getByRole('button', { name: 'Блоки' }).click();
    }
    await page.getByLabel('Загрузить фото').setInputFiles({
      name: 'installation.png',
      mimeType: 'image/png',
      buffer: TEST_PNG,
    });
    await page.getByLabel('Альтернативный текст').fill('Фото установки');
    await page.getByLabel('Режим изображения').selectOption('cover');

    const equipmentSelect = page.getByLabel('Установка для фото');
    const equipmentIds = await equipmentSelect.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
    expect(equipmentIds.length).toBeGreaterThan(1);
    await equipmentSelect.selectOption(equipmentIds[1]);
    await page.getByLabel('Заменить фото').setInputFiles({
      name: 'installation-second.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64'),
    });

    await page.screenshot({
      path: `output/playwright/monitoring-tile-editor-${testInfo.project.name.toLowerCase().replaceAll(' ', '-')}.png`,
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Сохранить шаблон' }).click();
    await expect(page.getByRole('dialog', { name: 'Редактор шаблона плитки' })).toBeHidden();
    await page.goto('/monitoring');
    const tiles = page.getByTestId('equipment-tile');
    await expect(tiles.first()).toBeVisible();
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThan(0);
    await expect(page.getByText('Проверка общего шаблона')).toHaveCount(tileCount);
    await expect(page.getByRole('img', { name: 'Фото установки' })).toHaveCount(2);
    const sourcesBeforeReload = await tiles.evaluateAll((items) => items
      .map((item) => item.querySelector<HTMLImageElement>('img[alt="Фото установки"]')?.src)
      .filter((source): source is string => Boolean(source)));
    expect(new Set(sourcesBeforeReload).size).toBe(2);

    await page.reload();
    await expect(page.getByText('Проверка общего шаблона')).toHaveCount(tileCount);
    await expect(page.getByRole('img', { name: 'Фото установки' })).toHaveCount(2);
    await expect.poll(() => page.getByRole('img', { name: 'Фото установки' }).evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('photos-after-reload.png'), fullPage: true });
    const sourcesAfterReload = await tiles.evaluateAll((items) => items
      .map((item) => item.querySelector<HTMLImageElement>('img[alt="Фото установки"]')?.src)
      .filter((source): source is string => Boolean(source)));
    expect(new Set(sourcesAfterReload).size).toBe(2);
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  });
});
