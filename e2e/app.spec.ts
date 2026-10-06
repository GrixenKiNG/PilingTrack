import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/disposable.fixture';

test.describe('PilingTrack E2E Tests', () => {
  test('health check endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api');
    expect(response.ok()).toBeTruthy();
    
    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('version');
  });

  test('login page loads and shows form', async ({ page }) => {
    await page.goto('/');
    // NB: do NOT waitForLoadState('networkidle') — the app holds an SSE
    // connection (/api/feedback/stream) open, so the network never goes
    // idle and networkidle times out at 30s. Wait for concrete UI instead.
    await expect(page).toHaveTitle(/PilingTrack/);

    // Check login form exists — wait for email input to be visible
    const emailInput = page.locator('#email');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
  });

  test('login fails with invalid credentials', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: {
        email: 'codex-invalid-' + randomUUID() + '@example.invalid',
        password: 'wrongpassword',
      },
    });
    
    expect(response.status()).toBe(401);
  });

  test('API rejects invalid JSON', async ({ request }) => {
    const response = await request.post('/api/auth/login', {
      data: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    
    expect(response.status()).toBe(400);
  });

  test('mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Check viewport meta is set
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /device-width/);
  });

  test('rate limiting works on login', async ({ request }) => {
    const email = 'codex-limit-' + randomUUID() + '@example.invalid';
    // Make 6 failed login attempts (limit is 5)
    for (let i = 0; i < 6; i++) {
      await request.post('/api/auth/login', {
        data: {
          email,
          password: 'wrong',
        },
      });
    }
    
    // 7th attempt should be rate limited
    const response = await request.post('/api/auth/login', {
      data: {
        email,
        password: 'wrong',
      },
    });
    
    expect(response.status()).toBe(429);
  });
});
