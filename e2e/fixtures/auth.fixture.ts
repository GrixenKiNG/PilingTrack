import { test as base } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';

/**
 * Test Users — predefined accounts for E2E testing.
 */

function testAccount(role: string) {
  return {
    email: process.env[`E2E_${role}_EMAIL`] || `codex-${role.toLowerCase()}@example.invalid`,
    password: process.env[`E2E_${role}_PASSWORD`] || '',
    role,
  };
}

export const TEST_USERS = {
  admin: testAccount('ADMIN'),
  dispatcher: testAccount('DISPATCHER'),
  operator: testAccount('OPERATOR'),
  assistant: testAccount('ASSISTANT'),
};

/**
 * Authenticated Test Context
 *
 * Provides pre-authenticated page instances with storage state.
 *
 * ВНИМАНИЕ. Здесь нет page object дашборда: он никогда не существовал в
 * репозитории, но импортировался — и один такой импорт обнуляет сбор ВСЕХ
 * тестов Playwright, а не только своего файла. Новые фикстуры добавлять
 * только на существующие модули.
 */

interface TestFixtures {
  loginPage: LoginPage;
  authenticatedPage: {
    page: ReturnType<typeof base.page>;
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

  authenticatedPage: async ({ page }, applyFixture) => {
    // Login before each test
    const user = TEST_USERS.operator;
    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill(user.email);
    await page.getByRole('textbox', { name: /password/i }).fill(user.password);
    await page.getByRole('button', { name: /войти|login/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });

    await applyFixture({ page });
  },
});

export { expect } from '@playwright/test';
