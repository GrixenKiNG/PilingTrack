import { expect, test } from './fixtures/disposable.fixture';

test.describe('ORION current public route', () => {
  test('stays usable at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Уверенно держим/);
    await expect(page.getByRole('link', { name: 'Запросить расчёт работ' })).toBeVisible();
    await expect(page.locator('.hero-copy')).toContainText('Свайные и шпунтовые работы под ключ');
    const metrics = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  });

  // The archived site retains its original equipment selector.
  test('switches equipment and exposes technical data on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/orion/previous');
    const tabs = page.getByRole('tablist', { name: 'Установки ОРИОН' }).getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.count()).toBeGreaterThan(1);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#fleet dl')).toBeVisible();
    await tabs.first().focus();
    await page.keyboard.press('Enter');
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('keeps content available with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/orion/previous');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Инженерная уверенность/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Начнём с исходных данных/ })).toBeVisible();
  });

  test('closes the mobile menu with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/orion/previous');
    await page.getByRole('button', { name: 'Открыть меню' }).click();
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeVisible();
  });
});
