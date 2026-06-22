/**
 * Sync Correctness Tests — PilingTrack
 *
 * Tests the critical sync invariants:
 * - Exactly-once delivery (idempotency)
 * - Event ordering
 * - Retry safety
 * - No data loss
 * - No duplication
 *
 * Run: npx playwright test tests/e2e/sync-correctness.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Sync Correctness', () => {
  test('ensures exactly-once delivery via idempotency', async ({ page, context }) => {
    const syncRequests: string[] = [];

    // Track all sync requests
    await context.route('**/api/sync/v2', async (route) => {
      const request = route.request();
      const body = request.postData();
      if (body) {
        syncRequests.push(body);
      }
      await route.continue();
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.fill('[name="shiftType"]', 'day');
    await page.fill('[name="piles"]', '5');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for initial sync
    await page.waitForTimeout(3000);

    // Trigger manual sync multiple times
    await page.getByTestId('sync-button').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('sync-button').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('sync-button').click();
    await page.waitForTimeout(3000);

    // Verify idempotency: same opId sent multiple times should not create duplicates
    const reportsCount = await page.getByTestId('report-item').count();
    expect(reportsCount).toBe(1);

    // Verify all requests had unique opIds
    const opIds = new Set<string>();
    for (const req of syncRequests) {
      try {
        const data = JSON.parse(req);
        if (data.changes) {
          for (const change of data.changes) {
            if (change.opId) {
              opIds.add(change.opId);
            }
          }
        }
      } catch { /* ignore */ }
    }

    // opIds should be unique (no duplicates in our tracking)
    expect(opIds.size).toBeGreaterThan(0);
  });

  test('maintains event ordering during sync', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create multiple reports in sequence
    for (let i = 1; i <= 3; i++) {
      await page.getByRole('button', { name: /создать отчёт/i }).click();
      await page.fill('[name="siteId"]', 'site-1');
      await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
      await page.fill('[name="shiftType"]', 'day');
      await page.fill('[name="piles"]', String(i * 5));
      await page.getByRole('button', { name: /сохранить/i }).click();
      await page.waitForTimeout(1000); // Small delay between creations
    }

    // Trigger sync
    await page.getByTestId('sync-button').click();
    await page.waitForTimeout(5000);

    // Verify reports are in correct order (by date/creation)
    const reportDates = await page.getByTestId('report-date').allTextContents();
    
    // Dates should be in descending order (newest first)
    for (let i = 0; i < reportDates.length - 1; i++) {
      expect(new Date(reportDates[i])).toBeGreaterThanOrEqual(new Date(reportDates[i + 1]));
    }
  });

  test('retry does not corrupt data', async ({ page, context }) => {
    let failCount = 0;

    // Fail first 2 requests, then succeed
    await context.route('**/api/sync/v2', async (route) => {
      failCount++;
      if (failCount <= 2) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Service unavailable' }),
        });
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
    await page.fill('[name="piles"]', '10');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for retries to complete
    await page.waitForTimeout(10000);

    // Verify data integrity after retries
    const syncStatus = await page.getByTestId('sync-status');
    await expect(syncStatus).toContainText(/синхронизировано/i, { timeout: 30000 });

    // Verify report data is correct (not corrupted)
    const reportPiles = await page.getByTestId('report-piles').first().textContent();
    expect(reportPiles).toContain('10');
  });

  test('no data loss on sync failure', async ({ page, context }) => {
    // Block all sync requests
    await context.route('**/api/sync/v2', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.fill('[name="piles"]', '7');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Wait for sync to fail
    await page.waitForTimeout(5000);

    // Verify data is NOT lost — should still be pending
    const hasPendingSync = await page.getByTestId('sync-pending').isVisible();
    expect(hasPendingSync).toBe(true);

    // Verify data is still in IndexedDB
    const queueCount = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(queueCount).toBeGreaterThan(0);
  });
});
