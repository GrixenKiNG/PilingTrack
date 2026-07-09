import { expect, test } from '@playwright/test';
import { login } from './page-objects/login.page';

const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
  'base64',
);

test.describe('monitoring equipment tile editor', () => {
  test('applies one layout with a different photo for every installation', async ({ page }, testInfo) => {
    test.skip(!['chromium', 'Mobile Chrome'].includes(testInfo.project.name));

    await login(page, 'admin@piling.ru', 'admin123');
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
    await page.goto('/monitoring?design=1');

    const editButton = page.getByRole('button', { name: 'Редактировать шаблон' });
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
      buffer: TEST_PNG,
    });

    await page.screenshot({
      path: `output/playwright/monitoring-tile-editor-${testInfo.project.name.toLowerCase().replaceAll(' ', '-')}.png`,
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Сохранить' }).click();
    const tiles = page.getByTestId('equipment-tile');
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
