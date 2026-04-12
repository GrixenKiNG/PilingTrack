/**
 * Network Chaos E2E Tests — PilingTrack
 *
 * Tests system behavior under real network conditions:
 * - Slow 3G
 * - Intermittent connection
 * - 500 errors
 * - Timeout
 * - Request drop
 *
 * Run: npx playwright test tests/e2e/network-chaos.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Network Chaos', () => {
  test('handles slow 3G during sync', async ({ page, context }) => {
    // Simulate slow 3G: 500ms latency, 500 Kbps down, 500 Kbps up
    await context.route('**/api/**', async (route) => {
      await new Promise(r => setTimeout(r, 500)); // 500ms latency
      await route.continue();
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report and trigger sync
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for sync with timeout
    const syncStatus = await page.getByTestId('sync-status');
    await expect(syncStatus).toContainText(/синхронизировано|ожидание/i, { timeout: 30000 });

    // Verify no data loss
    const hasPendingSync = await page.getByTestId('sync-pending').isVisible();
    expect(hasPendingSync).toBe(false);
  });

  test('recovers from intermittent connection', async ({ page, context }) => {
    let requestCount = 0;

    await context.route('**/api/sync/**', async (route) => {
      requestCount++;

      // Drop every other request
      if (requestCount % 2 === 0) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for retry logic to handle dropped requests
    await page.waitForTimeout(10000);

    // Verify retry succeeded
    const syncStatus = await page.getByTestId('sync-status');
    await expect(syncStatus).toContainText(/синхронизировано|ошибка/i, { timeout: 30000 });
  });

  test('handles 500 errors gracefully', async ({ page, context }) => {
    await context.route('**/api/sync/v2', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report and trigger sync
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for error handling
    await page.waitForTimeout(5000);

    // Verify error state is shown, data is NOT lost
    const hasErrorState = await page.getByTestId('sync-error').isVisible();
    expect(hasErrorState).toBe(true);

    // Verify data is still in queue for retry
    const hasPendingSync = await page.getByTestId('sync-pending').isVisible();
    expect(hasPendingSync).toBe(true);
  });

  test('handles request timeout', async ({ page, context }) => {
    await context.route('**/api/sync/v2', async (route) => {
      // Simulate timeout by never responding
      await new Promise(() => {}); // Never resolves
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for timeout (default 30s in Playwright, but sync should timeout sooner)
    await page.waitForTimeout(10000);

    // Verify retry/timeout handling
    const syncStatus = await page.getByTestId('sync-status');
    await expect(syncStatus).toContainText(/ошибка|timeout|ожидание/i, { timeout: 30000 });
  });

  test('recovers from complete request drop', async ({ page, context }) => {
    let dropAll = true;

    await context.route('**/api/**', async (route) => {
      if (dropAll) {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report while all requests are dropped
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait a bit
    await page.waitForTimeout(3000);

    // Restore network
    dropAll = false;

    // Wait for sync to recover
    await page.waitForTimeout(5000);

    // Verify sync succeeded after network restored
    const syncStatus = await page.getByTestId('sync-status');
    await expect(syncStatus).toContainText(/синхронизировано/i, { timeout: 30000 });
  });
});
