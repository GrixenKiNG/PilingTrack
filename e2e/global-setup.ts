/**
 * Global Setup — PilingTrack E2E Tests
 *
 * Runs once before all tests.
 * Authenticates users and saves storage state for reuse.
 */

import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const AUTH_DIR = path.join(__dirname, '.auth');

async function globalSetup(config: FullConfig) {
  console.log('🔐 Global Setup: Authenticating users...');

  // Ensure auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const browser = await chromium.launch();

  // Login as operator (primary test user)
  const operatorPage = await browser.newPage();
  await operatorPage.goto(`${BASE_URL}/login`);
  await operatorPage.getByRole('textbox', { name: /email/i }).fill('operator@piling.ru');
  await operatorPage.getByRole('textbox', { name: /password/i }).fill('operator123');
  await operatorPage.getByRole('button', { name: /войти|login/i }).click();
  await operatorPage.waitForURL(/dashboard/, { timeout: 10000 });
  await operatorPage.context().storageState({ path: path.join(AUTH_DIR, 'user.json') });
  console.log('   ✅ Operator authenticated');

  // Login as admin (admin tests)
  const adminPage = await browser.newPage();
  await adminPage.goto(`${BASE_URL}/login`);
  await adminPage.getByRole('textbox', { name: /email/i }).fill('admin@piling.ru');
  await adminPage.getByRole('textbox', { name: /password/i }).fill('admin123');
  await adminPage.getByRole('button', { name: /войти|login/i }).click();
  await adminPage.waitForURL(/dashboard/, { timeout: 10000 });
  await adminPage.context().storageState({ path: path.join(AUTH_DIR, 'admin.json') });
  console.log('   ✅ Admin authenticated');

  await browser.close();

  // Set base URL in config
  process.env.BASE_URL = BASE_URL;

  console.log('✅ Global Setup complete');
}

export default globalSetup;
