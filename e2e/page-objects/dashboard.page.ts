import { Page, Locator } from '@playwright/test';

/**
 * Page Object — Dashboard Page
 *
 * Encapsulates dashboard interactions for E2E tests.
 */

export class DashboardPage {
  readonly page: Page;
  readonly headerTitle: Locator;
  readonly reportsTable: Locator;
  readonly newReportButton: Locator;
  readonly sitesDropdown: Locator;
  readonly crewSelector: Locator;
  readonly statsCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.headerTitle = page.getByRole('heading', { name: /панель|dashboard/i });
    this.reportsTable = page.getByRole('table');
    this.newReportButton = page.getByRole('button', { name: /новый|new|создать/i });
    this.sitesDropdown = page.locator('select').first();
    this.crewSelector = page.locator('[data-testid="crew-select"]');
    this.statsCards = page.locator('[data-testid="stat-card"]');
  }

  async goto() {
    await this.page.goto('/dashboard');
  }

  async createNewReport() {
    await this.newReportButton.click();
  }

  async getReportsCount(): Promise<number> {
    const rows = this.reportsTable.locator('tbody tr');
    return rows.count();
  }

  async getFirstReportRow(): Promise<string | null> {
    const firstRow = this.reportsTable.locator('tbody tr').first();
    return firstRow.textContent().then(t => t?.trim() || null);
  }

  async filterBySite(siteName: string) {
    await this.sitesDropdown.selectOption({ label: siteName });
  }

  async waitForDashboardLoad(timeout = 10000) {
    await this.headerTitle.waitFor({ timeout });
  }

  async getStatsValues(): Promise<Record<string, string>> {
    const cards = await this.statsCards.all();
    const values: Record<string, string> = {};
    for (const card of cards) {
      const text = await card.textContent();
      const match = text?.match(/([А-ЯA-Za-z\s]+):\s*([\d.]+)/);
      if (match) values[match[1].trim()] = match[2];
    }
    return values;
  }

  async navigateToReports() {
    await this.page.getByRole('link', { name: /отчёты|reports/i }).click();
  }

  async navigateToCrews() {
    await this.page.getByRole('link', { name: /бригад|crew/i }).click();
  }

  async navigateToSites() {
    await this.page.getByRole('link', { name: /объект|site/i }).click();
  }
}
