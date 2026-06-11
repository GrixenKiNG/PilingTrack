import { Page, Locator, expect } from '@playwright/test';

/**
 * Page Object — Login Page
 *
 * Encapsulates login page interactions for E2E tests.
 */

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly pinInput: Locator;
  readonly pinLoginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: /email/i });
    this.passwordInput = page.getByRole('textbox', { name: /password|парол/i });
    this.loginButton = page.getByRole('button', { name: /войти|login/i });
    this.errorMessage = page.getByText(/неверный|invalid|ошибка/i);
    this.pinInput = page.locator('input[type="password"]').first();
    this.pinLoginButton = page.getByRole('button', { name: /pin/i });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async loginWithEmail(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Hydration-safe email login. Replaces the brittle
   * fill → click → waitForTimeout(3000) → expect(url).not.toContain('login')
   * pattern that flaked under load.
   *
   * Until Next.js hydrates the form, a submit click triggers a *native* HTML
   * form submit: the page reloads, the controlled inputs are cleared, and
   * /api/auth/login is never called. We therefore retry the fill+click as one
   * unit (`expect.toPass`) until we observe the /api/auth/login response, then
   * wait for the redirect off /login instead of guessing a timeout.
   *
   * Extracted from loginAsAdmin in inspection-to-flow.spec.ts. Navigates to
   * '/' itself, so callers don't need a preceding page.goto.
   */
  async login(email: string, password: string): Promise<void> {
    await this.page.goto('/');
    const emailField = this.page.locator('#email');
    const passwordField = this.page.locator('#password');
    await emailField.waitFor({ state: 'visible', timeout: 10000 });

    await expect(async () => {
      await emailField.fill(email);
      await passwordField.fill(password);
      const respPromise = this.page
        .waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 4000 })
        .catch(() => null);
      await this.page.locator('button[type="submit"]').click();
      const resp = await respPromise;
      expect(resp, 'submit ушёл до гидрации — /api/auth/login не вызван').not.toBeNull();
      expect(resp!.ok()).toBe(true);
    }).toPass({ timeout: 30000, intervals: [1000, 2000, 3000] });

    await this.page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
  }

  async loginWithPin(pin: string) {
    await this.pinInput.fill(pin);
    await this.pinLoginButton.click();
  }

  async getErrorMessage(): Promise<string> {
    return this.errorMessage.textContent().then(t => t?.trim() || '');
  }

  async isErrorMessageVisible(): Promise<boolean> {
    return this.errorMessage.isVisible();
  }

  async waitForUrl(pattern: RegExp, timeout = 10000) {
    await this.page.waitForURL(pattern, { timeout });
  }
}

/**
 * Convenience wrapper around LoginPage.login for specs that don't otherwise
 * use the page object — one-line, hydration-safe login from a bare page.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await new LoginPage(page).login(email, password);
}
