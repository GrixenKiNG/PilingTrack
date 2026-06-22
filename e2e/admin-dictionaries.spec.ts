import { expect, test } from '@playwright/test';
import { login } from './page-objects/login.page';

const ADMIN = { email: 'admin@piling.ru', password: 'admin123' };

test.describe('Справочники организации', () => {
  test('реестр и форма марки сваи работают на desktop и mobile', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/dictionaries');

    await expect(page.getByRole('heading', { name: 'Справочники' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Отчёты' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Планы' })).toBeVisible();

    const firstDataRow = page.locator('tbody tr').first();
    await expect(firstDataRow).toBeVisible();
    const rowName = (await firstDataRow.locator('td').first().innerText()).trim();
    const reportCount = Number((await firstDataRow.locator('td').nth(3).innerText()).trim());
    const planCount = Number((await firstDataRow.locator('td').nth(4).innerText()).trim());
    if (reportCount > 0 || planCount > 0) {
      await expect(page.getByRole('button', { name: `Переименовать ${rowName}` })).toBeDisabled();
      await expect(page.getByRole('button', { name: `Архивировать ${rowName}` })).toBeEnabled();
    }

    await page.getByRole('button', { name: 'Добавить марку сваи' }).click();
    await expect(page.getByLabel('Название')).toBeVisible();
    await expect(page.getByLabel('Длина, м')).toHaveAttribute('required', '');
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await page.getByRole('button', { name: 'Отмена' }).click();

    if (process.env.CAPTURE_DICTIONARIES_UI) {
      await page.screenshot({ path: 'C:/tmp/pilingtrack-dictionaries-desktop.png', fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Справочники' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    if (process.env.CAPTURE_DICTIONARIES_UI) {
      await page.screenshot({ path: 'C:/tmp/pilingtrack-dictionaries-mobile.png', fullPage: true });
    }
  });
});
