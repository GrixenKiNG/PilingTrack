import { Page, Locator } from '@playwright/test';

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
