import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/disposable.fixture';

// Rate-limit lives in a dedicated file and runs only on a single project.
// Across parallel Playwright projects the rate-limiter (IP-scoped) would
// otherwise block unrelated auth tests in sibling projects.
test.describe('E2E — Rate limiting', () => {
  test('rate limiting on login', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Runs only on chromium to avoid cross-project IP collisions');
    const email = 'codex-limit-' + randomUUID() + '@example.invalid';
    for (let i = 0; i < 8; i++) {
      await request.post('/api/auth/login', {
        data: { email, password: 'wrong' },
      });
    }
    const res = await request.post('/api/auth/login', {
      data: { email, password: 'wrong' },
    });
    expect(res.status()).toBe(429);
  });
});
