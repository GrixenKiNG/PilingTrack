import { test as base } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';

/**
 * Test Users — predefined accounts for E2E testing.
 */

export const TEST_USERS = {
  admin: {
    email: 'admin@piling.ru',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    role: 'ADMIN',
  },
  dispatcher: {
    email: 'dispatch@piling.ru',
    password: process.env.DISPATCH_PASSWORD || 'dispatch123',
    role: 'DISPATCHER',
  },
  operator: {
    email: 'operator@piling.ru',
    password: process.env.OPERATOR_PASSWORD || 'operator123',
    role: 'OPERATOR',
  },
  assistant: {
    email: 'helper@piling.ru',
    password: process.env.ASSISTANT_PASSWORD || 'helper123',
    role: 'ASSISTANT',
  },
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
