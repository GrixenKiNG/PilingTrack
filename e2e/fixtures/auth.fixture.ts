import { test as base } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';
import { DashboardPage } from '../page-objects/dashboard.page';

/**
 * Test Users — predefined accounts for E2E testing.
 */

export const TEST_USERS = {
  admin: {
    email: 'admin@piling.ru',
    password: process.env.ADMIN_PASSWORD || '1234',
    role: 'ADMIN',
  },
  dispatcher: {
    email: 'dispatch@piling.ru',
    password: process.env.DISPATCH_PASSWORD || '2222',
    role: 'DISPATCHER',
  },
  operator: {
    email: 'operator@piling.ru',
    password: process.env.OPERATOR_PASSWORD || '0000',
    role: 'OPERATOR',
  },
  assistant: {
    email: 'helper@piling.ru',
    password: process.env.ASSISTANT_PASSWORD || '3333',
    role: 'ASSISTANT',
  },
};

/**
 * Authenticated Test Context
 *
 * Provides pre-authenticated page instances with storage state.
 */

interface TestFixtures {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  authenticatedPage: {
    page: ReturnType<typeof base.page>;
    dashboard: DashboardPage;
  };
}

/**
 * Extend Playwright test with custom fixtures.
 */

export const test = base.extend<TestFixtures>({
  loginPage: async ({ page }, applyFixture) => {
    const loginPage = new LoginPage(page);
    await applyFixture(loginPage);
  },

  dashboardPage: async ({ page }, applyFixture) => {
    const dashboardPage = new DashboardPage(page);
    await applyFixture(dashboardPage);
  },

  authenticatedPage: async ({ page }, applyFixture) => {
    // Login before each test
    const user = TEST_USERS.operator;
    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(user.email);
    await page.getByRole('textbox', { name: /password/i }).fill(user.password);
    await page.getByRole('button', { name: /войти|login/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });

    const dashboard = new DashboardPage(page);
    await applyFixture({ page, dashboard });
  },
});

export { expect } from '@playwright/test';
