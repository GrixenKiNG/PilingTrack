/**
 * Offline-First E2E Tests — PilingTrack
 *
 * Tests the critical offline → online sync flow:
 * 1. Create report without network
 * 2. Close tab → reopen → data persists
 * 3. Network reconnect → sync triggers
 * 4. Duplicate prevention
 * 5. Sync status visible to user
 *
 * Run: npx playwright test tests/e2e/offline-sync.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('Offline-First Sync', () => {
  test('creates report offline and syncs when online', async ({ page, context }) => {
    // 1. Go offline
    await context.setOffline(true);

    // 2. Navigate to app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 3. Create report (should save to IndexedDB)
    await page.getByRole('button', { name: /создать отчёт/i }).click();

    // Fill report form
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.fill('[name="shiftType"]', 'day');
    await page.fill('[name="piles"]', '5');

    // Submit — should save locally
    await page.getByRole('button', { name: /сохранить/i }).click();

    // 4. Verify data is in IndexedDB (offline queue)
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

    // 5. Go online
    await context.setOffline(false);

    // 6. Wait for sync to complete
    await page.waitForTimeout(5000);

    // 7. Verify sync status updated
    const syncStatus = await page.getByTestId('sync-status').textContent();
    expect(syncStatus).toContain('синхронизировано');

    // 8. Verify queue is empty
    const queueCountAfter = await page.evaluate(async () => {
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

    expect(queueCountAfter).toBe(0);
  });

  test('persists data across tab close/reopen', async ({ page, context }) => {
    await context.setOffline(true);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.fill('[name="shiftType"]', 'day');
    await page.fill('[name="piles"]', '3');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Close tab
    await page.close();

    // Reopen
    const newPage = await context.newPage();
    await newPage.goto('/');
    await newPage.waitForLoadState('networkidle');

    // Verify data still there
    const hasPendingSync = await newPage.getByTestId('sync-pending').isVisible();
    expect(hasPendingSync).toBe(true);
  });

  test('prevents duplicate sync operations', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto('/');

    // Create and save report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', new Date().toISOString().split('T')[0]);
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Go online, trigger sync
    await context.setOffline(false);
    await page.waitForTimeout(3000);

    // Trigger sync again (manual)
    await page.getByTestId('sync-button').click();
    await page.waitForTimeout(2000);

    // Verify no duplicates created
    const reportsCount = await page.getByTestId('report-item').count();
    expect(reportsCount).toBe(1);
  });
});
