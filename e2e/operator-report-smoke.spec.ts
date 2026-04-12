import { expect, test } from '@playwright/test';

test('operator can authenticate and access reports', async ({ request }) => {
  // 1. Login as operator
  const loginRes = await request.post('/api/auth/login', {
    data: { email: 'operator@piling.ru', password: '0000' },
  });
  expect(loginRes.ok()).toBe(true);
  const loginBody = await loginRes.json();
  expect(loginBody.user.role).toBe('OPERATOR');
  expect(loginBody.user.id).toBeDefined();

  // 2. Verify operator gets 403 on admin-only endpoints
  const usersRes = await request.get('/api/users');
  expect(usersRes.status()).toBe(403);

  // 3. Verify operator can read dictionary data
  const dictRes = await request.get('/api/dictionary/all');
  expect(dictRes.ok()).toBe(true);

  // 4. Verify operator can access sites
  const sitesRes = await request.get('/api/sites');
  expect(sitesRes.ok()).toBe(true);

  // 5. Verify operator can access their own profile
  const meRes = await request.get('/api/auth/me');
  expect(meRes.ok()).toBe(true);
  const meBody = await meRes.json();
  expect(meBody.user.role).toBe('OPERATOR');

  // 6. Verify operator gets 403 on analytics
  const analyticsRes = await request.get('/api/analytics/sites');
  expect(analyticsRes.status()).toBe(403);
});
