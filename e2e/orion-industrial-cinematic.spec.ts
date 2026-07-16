import { expect, test } from '@playwright/test';

test.describe('ORION Industrial Cinematic', () => {
  test('stays usable at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/orion');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Свайные работы');
    await expect(page.getByRole('link', { name: /обсудить объект/i }).first()).toBeVisible();
    await expect(page.getByText('единиц собственного парка')).toBeVisible();
    await expect(page.getByText(/референс модели/i)).toBeVisible();

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  });

  test('keeps content available with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/orion');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /свой контроль/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /вашего объекта/i })).toBeVisible();
  });

  test('closes the mobile menu with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/orion');

    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeVisible();
  });
});

