import { expect, test } from '@playwright/test';
import { login } from './page-objects/login.page';

const ADMIN = { email: 'admin@piling.ru', password: 'admin123' };

test.describe('Пользователи — операционный модуль', () => {
  test('таблица, поиск и правая панель работают на desktop и mobile', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
    await expect(page.getByText('Бригада / установка')).toBeVisible();
    await expect(page.getByPlaceholder('ФИО, email или телефон')).toBeVisible();

    for (const tab of ['Обзор', 'Закрепление', 'Активность', 'Доступ', 'История']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    }

    const firstRow = page.locator('section [role="button"]').first();
    await expect(firstRow).toBeVisible();
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
