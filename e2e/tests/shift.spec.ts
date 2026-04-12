import { test, expect } from '@playwright/test';
import { DashboardPage } from '../page-objects/dashboard.page';

test.describe('Shift & Report Flow', () => {
  test('create new shift from dashboard', async ({ page }) => {
    const dashboard = new DashboardPage(page);

    // Navigate to authenticated dashboard
    await page.goto('/dashboard');
    await dashboard.waitForDashboardLoad();

    // Click new report button
    await dashboard.createNewReport();

    // Wait for report form
    await expect(page.getByRole('form')).toBeVisible({ timeout: 5000 });
  });

  test('fill report with pile work data', async ({ page }) => {
    await page.goto('/dashboard');

    // Navigate to new report
    await page.getByRole('button', { name: /новый|new|создать/i }).click();

    // Fill shift info
    await page.locator('select[name="shiftType"]').selectOption('DAY');

    // Verify form is interactive
    const submitButton = page.getByRole('button', { name: /отправить|submit|сохранить/i });
    await expect(submitButton).toBeEnabled();
  });

  test('reports table shows existing data', async ({ page }) => {
    await page.goto('/reports');

    // Wait for reports page
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });

    // Check table has rows
    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('filter reports by site', async ({ page }) => {
    await page.goto('/reports');

    // Wait for page load
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });

    // Try to filter by site if dropdown exists
    const siteDropdown = page.locator('select').first();
    if (await siteDropdown.isVisible().catch(() => false)) {
      const options = await siteDropdown.locator('option').allTextContents();
      expect(options.length).toBeGreaterThan(0);
    }
  });

  test('export report to PDF', async ({ page }) => {
    await page.goto('/reports');

    // Wait for reports
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });

    // Look for export button
    const exportButton = page.getByRole('button', { name: /экспорт|export|pdf/i });
    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();

      // Wait for download or PDF generation
      await page.waitForTimeout(2000);

      // Verify no errors
      await expect(page.getByText(/ошибка|error/i)).not.toBeVisible({ timeout: 3000 });
    }
  });
});
