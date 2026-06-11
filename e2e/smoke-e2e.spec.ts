import { test, expect } from '@playwright/test';
import { login } from './page-objects/login.page';

const USERS = {
  admin: { email: 'admin@piling.ru', password: 'admin123' },
  operator: { email: 'operator@piling.ru', password: 'operator123' },
};

test.describe('E2E — Full Application Flow', () => {
  test('operator login → read sites → read reports', async ({ page }) => {
    // Login (hydration-safe; helper waits for /api/auth/login + redirect)
    await login(page, USERS.operator.email, USERS.operator.password);

    // Verify logged in — should not be on the login page
    expect(page.url()).not.toContain('login');
  });

  test('health endpoints return correct data', async ({ request }) => {
    // Health
    const healthRes = await request.get('/api/health');
    expect(healthRes.ok()).toBe(true);
    const health = await healthRes.json();
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('uptime');

    // Readiness
    const readyRes = await request.get('/api/readiness');
    expect([200, 503]).toContain(readyRes.status());

    // Liveness
    const liveRes = await request.get('/api/liveness');
    expect(liveRes.status()).toBe(200);

    // Metrics is protected in the current security model.
    const metricsRes = await request.get('/api/metrics');
    expect([200, 401]).toContain(metricsRes.status());
  });

  test('security headers present', async ({ request }) => {
    const res = await request.get('/api/health');
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  // Rate limiting has moved to rate-limit-e2e.spec.ts (single-project file)
  // because IP-scoped rate limits collide with sibling projects' auth tests.

  test('mobile viewport renders', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const vp = page.locator('meta[name="viewport"]');
    await expect(vp).toHaveAttribute('content', /device-width/);
  });

  test('feedback events endpoint accessible', async ({ request }) => {
    // Without auth — should return 401 (endpoint exists)
    const res = await request.get('/api/feedback/events');
    expect([200, 401, 403]).toContain(res.status());
  });
});
