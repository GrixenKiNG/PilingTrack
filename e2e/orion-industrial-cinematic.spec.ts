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

  // AC: At 375x812, the PVE 50PR passport exposes its sourced details and stays usable without horizontal overflow.
  // Behavior: Open the PVE passport -> inspect its document actions -> close it with Enter.
  // @category: fixture-e2e
  // @lane: fixture-e2e
  // @dependency: ORION static equipment profiles
  // @complexity: medium
  // ROI: 65
  test('opens and closes the PVE technical passport on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/orion');

    const toggle = page.getByRole('button', { name: 'Все характеристики PVE 50PR' });
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = page.getByRole('region', { name: 'Технические характеристики PVE 50PR' });
    await expect(region).toBeVisible();
    await expect(region.getByText(
      'Справочные характеристики модели. Фактическая комплектация конкретной установки уточняется по паспорту машины.',
      { exact: true },
    )).toBeVisible();

    const downloadLink = region.getByRole('link', { name: /скачать pdf на русском/i });
    await expect(downloadLink).toHaveAttribute('href', '/orion/specs/pve-50pr.pdf');
    await expect(downloadLink).toHaveAttribute('download', '');

    const sourceLink = region.getByRole('link', { name: /источник характеристик/i });
    await expect(sourceLink).toHaveAttribute('href', 'https://www.agd-equipment.co.uk/images/articles/large/folder_pve_piling_1005_lr.pdf');
    await expect(sourceLink).toHaveAttribute('target', '_blank');
    await expect(sourceLink).toHaveAttribute('rel', 'noreferrer');

    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();
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

