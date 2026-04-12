import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';

test.describe('Login Flow', () => {
  test('successful login with email and password', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.loginWithEmail('operator@piling.ru', '0000');
    await loginPage.waitForUrl(/dashboard/);

    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole('heading', { name: /панель|dashboard/i })).toBeVisible();
  });

  test('failed login shows error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.loginWithEmail('invalid@piling.ru', 'wrongpassword');

    // Wait for error message
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 5000 });
  });

  test('login with empty credentials shows validation', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.loginButton.click();

    // Should not navigate
    await expect(page).toHaveURL(/login/);
  });

  test('login redirects to dashboard for authenticated users', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.loginWithEmail('operator@piling.ru', '0000');
    await loginPage.waitForUrl(/dashboard/);

    // Verify dashboard elements
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });
  });
});
