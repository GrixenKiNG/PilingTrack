import { test as base, expect } from '@playwright/test';
import { randomInt } from 'node:crypto';

// Separate test clients; the disposable trusted proxy still enforces limits
// within one client (including rate-limit-e2e.spec.ts).
export const test = base.extend<{ localMutations: void }>({
  localMutations: [async ({ context }, applyFixture) => {
    if (/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) {
      await context.route('**/*', async (route) => {
        const request = route.request();
        const local = ['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname);
        if (!local && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.abort('blockedbyclient');
        else await route.continue();
      });
    }
    await applyFixture();
  }, { auto: true }],
  extraHTTPHeaders: async ({ extraHTTPHeaders }, applyFixture) => {
    await applyFixture({ ...extraHTTPHeaders, 'x-forwarded-for': `127.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}` });
  },
});
export { expect };
