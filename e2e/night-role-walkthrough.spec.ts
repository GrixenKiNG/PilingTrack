import { test, expect } from './fixtures/disposable.fixture';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { login } from './page-objects/login.page';
import { ROLE_NAVIGATION } from '../src/components/piling/icons/role-navigation';
import { can, type Role } from '../src/core/security/authorization';
import { operatorRouteOwnsNavigation } from '../src/app/(app)/operator-layout-policy';

const roles: Role[] = ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER'];

// Assertions compare the live application with its public permission contract.
// No private credentials or existing development/staging accounts are used.
for (const role of roles) {
  test(`${role}: menu, pages, tabs, forbidden API and session replacement`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const fixture = await createRoleAuditFixture();
    // Observe fetch completion in the current document. Browser Request events
    // can omit cancellation events when a routed fetch is aborted by React.
    // This is instrumentation only: original responses/errors are returned.
    await page.addInitScript(() => {
      const state = { pending: 0, lastAt: Date.now() };
      Object.defineProperty(window, '__nightFetch', { value: state });
      const original = window.fetch;
      window.fetch = async (...args) => {
        const target = args[0] instanceof Request ? args[0].url : String(args[0]);
        const pathname = new URL(target, location.href).pathname;
        if (!pathname.startsWith('/api/') || pathname === '/api/feedback/stream') return original(...args);
        state.pending++;
        state.lastAt = Date.now();
        const finished = () => { state.pending--; state.lastAt = Date.now(); };
        try {
          const response = await original(...args);
          void response.clone().arrayBuffer().catch(() => {}).finally(finished);
          return response;
        } catch (error) { finished(); throw error; }
      };
    });
    const rows: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    const pending = new Map<object, string>();
    const network: Array<Record<string, unknown>> = [];
    const requestIds = new WeakMap<object, number>();
    let nextRequestId = 0;
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/') && pathname !== '/api/feedback/stream') {
        requestIds.set(request, ++nextRequestId);
        network.push({ event: 'request', id: nextRequestId, path: pathname, at: Date.now() });
        pending.set(request, pathname);
      }
    });
    const finished = (request: { url(): string }) => {
      if (requestIds.has(request)) network.push({ event: 'finished', id: requestIds.get(request), path: new URL(request.url()).pathname, at: Date.now() });
      pending.delete(request);
    };
    page.on('requestfinished', finished);
    page.on('requestfailed', finished);
    const settled = async () => {
      try {
        await expect.poll(() => page.evaluate(() => {
          const state = (window as Window & { __nightFetch?: { pending: number; lastAt: number } }).__nightFetch;
          return state !== undefined && state.pending === 0 && Date.now() - state.lastAt >= 250;
        }), { timeout: 15_000 }).toBe(true);
      } catch (error) {
        await info.attach('pending-API', { body: JSON.stringify([...pending.values()]), contentType: 'application/json' });
        await info.attach('network-events', { body: JSON.stringify(network), contentType: 'application/json' });
        throw error;
      }
    };
    const apiErrors: Array<{ path: string; status: number }> = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && response.status() >= 400) {
        apiErrors.push({ path: url.pathname, status: response.status() });
      }
      if (requestIds.has(response.request())) network.push({ event: 'response', id: requestIds.get(response.request()), path: url.pathname, status: response.status(), at: Date.now() });
    });
    await login(page, fixture.users[role].email, fixture.password);
    await expect(page.getByText('QA ' + role, { exact: true }).first()).toBeVisible();
    // Do not cancel the first dashboard fetches with a forced navigation:
    // Chromium can leave those old Request objects without a finish event.
    await settled();
    rows.push({ step: 'login', role, path: new URL(page.url()).pathname });
    const expected = ROLE_NAVIGATION[role];
    // The current operator/assistant home deliberately owns its own navigation.
    // The shared navigation contract is visible on their history page instead.
    if (operatorRouteOwnsNavigation(new URL(page.url()).pathname)) {
      await page.goto('/history');
      await settled();
    }
    for (const item of expected) {
      await expect.soft(page.locator(`a[href="${item.href}"]`).first(), `menu: ${role} ${item.href}`).toBeAttached();
    }
    for (const item of expected) {
      apiErrors.length = 0;
      await page.goto(item.href);
      await settled();
      await expect(page.locator('body')).not.toContainText('Application error:');
      expect.soft(new URL(page.url()).pathname, `${role} opens ${item.href}`).toBe(item.href);
      const tabs = (await page.getByRole('tab').allTextContents()).map(label => label.trim());
      for (const label of tabs) {
        // The list can include nested tabs of the initially selected panel.
        // Restore that panel before trying another initial tab.
        await page.goto(item.href);
        await settled();
        const tab = page.getByRole('tab', { name: label, exact: true }).first();
        await expect.soft(tab).toBeVisible();
        if (await tab.count() === 0) {
          rows.push({ role, path: item.href, tab: label, step: 'unavailable after restoring initial panel' });
          continue;
        }
        if (await tab.isEnabled()) {
          await tab.click();
          await settled();
          await expect.soft(tab).toHaveAttribute('aria-selected', 'true');
          rows.push({ role, path: item.href, tab: label, step: 'tab opened' });
        } else rows.push({ role, path: item.href, tab: label, step: 'disabled, not exercised' });
      }
      await page.screenshot({ path: info.outputPath(role + '-' + item.href.replaceAll('/', '_') + '.png'), fullPage: true });
      rows.push({ role, path: item.href, step: 'page opened', apiErrors: [...apiErrors], actions: await page.getByRole('button').allTextContents() });
      expect.soft(apiErrors, `normal navigation API errors: ${role} ${item.href}`).toEqual([]);
    }
    // A direct URL is tested separately from menu visibility.
    await page.goto('/admin/users');
    await expect.soft(page).toHaveURL(role === 'ADMIN' ? /\/admin\/users$/ : /\/no-access$/);
    const users = await page.request.get('/api/users');
    expect.soft(users.status(), 'users.read is different from users.manage').toBe(can({ role }, 'users.read') ? 200 : 403);
    rows.push({ role, step: 'direct users API', expected: can({ role }, 'users.read') ? 200 : 403, actual: users.status() });
    if (role !== 'ADMIN') {
      const mutation = await page.request.post('/api/users', { headers: { Origin: new URL(page.url()).origin }, data: {} });
      expect.soft(mutation.status(), 'forbidden create user fails before validation').toBe(403);
      rows.push({ role, step: 'forbidden create user', actual: mutation.status() });
    }
    const logout = await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    expect.soft(logout.status()).toBe(200);
    const afterLogout = await page.request.get('/api/auth/me');
    expect.soft(afterLogout.status()).toBe(401);
    rows.push({ role, step: 'logout', actual: logout.status(), afterLogout: afterLogout.status() });
    const nextRole: Role = role === 'OPERATOR' ? 'ASSISTANT' : 'OPERATOR';
    await login(page, fixture.users[nextRole].email, fixture.password);
    const changed = await page.request.get('/api/auth/me');
    expect.soft((await changed.json()).user.role).toBe(nextRole);
    rows.push({ role, step: 'session replacement', nextRole });
    expect.soft(errors, 'uncaught browser errors').toEqual([]);
    await info.attach('role-observations', { body: JSON.stringify({ rows, errors }, null, 2), contentType: 'application/json' });
  });
}
