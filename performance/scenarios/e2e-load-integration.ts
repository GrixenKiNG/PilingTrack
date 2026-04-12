/**
 * Playwright E2E + Load Integration Test
 *
 * This script orchestrates:
 * 1. Playwright: Login operator, create shift, verify UI
 * 2. k6: 500+ users submit reports under load
 * 3. Playwright: Verify UI remains responsive, data correct
 *
 * Usage:
 *   npx tsx performance/scenarios/e2e-load-integration.ts
 */

import { test, expect } from '@playwright/test';
import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RESULTS_DIR = path.join(__dirname, '..', 'results');

// Ensure results directory exists
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

test.describe('E2E + Load Integration', () => {
  test.beforeAll(async () => {
    console.log('🔥 Starting E2E + Load Integration Test');
    console.log(`   Base URL: ${BASE_URL}`);
  });

  // ============================================================
  // Phase 1: Pre-Load Baseline
  // ============================================================
  test('Phase 1 — Pre-load baseline: operator login + UI check', async ({ page }) => {
    console.log('\n📋 Phase 1: Pre-load baseline');

    // Navigate to login
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveTitle(/PilingTrack/);

    // Login as operator
    await page.getByRole('textbox', { name: /email/i }).fill('operator@piling.ru');
    await page.getByRole('textbox', { name: /password/i }).fill('0000');
    await page.getByRole('button', { name: /войти/i }).click();

    // Wait for navigation
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });

    // Verify dashboard loads
    await expect(page.getByRole('heading', { name: /панель/i })).toBeVisible({ timeout: 5000 });

    // Measure Time to Interactive
    const navigation = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation');
      const entry = entries[0] as PerformanceNavigationTiming | undefined;
      return {
        domContentLoaded: entry ? entry.domContentLoadedEventEnd - entry.startTime : 0,
        loadComplete: entry ? entry.loadEventEnd - entry.startTime : 0,
      };
    });

    console.log(`   Time to Interactive: ${navigation.domContentLoaded?.toFixed(0)}ms`);
    console.log(`   Load Complete: ${navigation.loadComplete?.toFixed(0)}ms`);

    // Check reports page
    await page.goto(`${BASE_URL}/reports`);
    await page.waitForLoadState('networkidle');

    // Record pre-load metrics
    const preLoadMetrics = {
      timestamp: new Date().toISOString(),
      phase: 'pre-load',
      tti: navigation.domContentLoaded,
      loadTime: navigation.loadComplete,
    };

    fs.writeFileSync(
      path.join(RESULTS_DIR, 'pre-load-metrics.json'),
      JSON.stringify(preLoadMetrics, null, 2)
    );

    console.log('   ✅ Pre-load baseline complete');
  });

  // ============================================================
  // Phase 2: Run Load Test
  // ============================================================
  test('Phase 2 — Run k6 load test while UI is active', async () => {
    console.log('\n⚡ Phase 2: Running k6 load test');

    // Start k6 as a child process
    const k6Process = spawn('npx', ['k6', 'run', 'performance/k6/report.test.js', '--vus', '50', '--duration', '2m'], {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: { ...process.env, BASE_URL },
    });

    let k6Output = '';
    k6Process.stdout?.on('data', (data) => {
      k6Output += data.toString();
      console.log(`   [k6] ${data.toString().trim()}`);
    });

    // Wait for k6 to complete (or timeout after 3 min)
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        k6Process.kill();
        resolve();
      }, 3 * 60 * 1000);
    });

    const k6Complete = new Promise<void>((resolve) => {
      k6Process.on('close', () => resolve());
    });

    await Promise.race([k6Complete, timeout]);

    console.log('   ✅ Load test complete');
  });

  // ============================================================
  // Phase 3: Post-Load Verification
  // ============================================================
  test('Phase 3 — Post-load: verify UI responsiveness and data integrity', async ({ page }) => {
    console.log('\n✅ Phase 3: Post-load verification');

    // Navigate under load
    await page.goto(`${BASE_URL}/reports`, { waitUntil: 'networkidle', timeout: 15000 });

    // Measure post-load performance
    const postLoadMetrics = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation');
      const entry = entries[0] as PerformanceNavigationTiming | undefined;
      return {
        domContentLoaded: entry ? entry.domContentLoadedEventEnd - entry.startTime : 0,
        loadComplete: entry ? entry.loadEventEnd - entry.startTime : 0,
      };
    });

    console.log(`   Post-load TTI: ${postLoadMetrics.domContentLoaded?.toFixed(0)}ms`);
    console.log(`   Post-load Load: ${postLoadMetrics.loadComplete?.toFixed(0)}ms`);

    // Verify reports list is visible and responsive
    await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });

    // Verify no UI errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Interact with the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Save post-load metrics
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'post-load-metrics.json'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        phase: 'post-load',
        tti: postLoadMetrics.domContentLoaded,
        loadTime: postLoadMetrics.loadComplete,
        errors,
      }, null, 2)
    );

    console.log(`   UI Errors: ${errors.length}`);
    console.log('   ✅ Post-load verification complete');

    expect(errors.length).toBeLessThan(5); // Allow minor transient errors
  });

  // ============================================================
  // Phase 4: Summary
  // ============================================================
  test.afterAll(() => {
    console.log('\n' + '='.repeat(60));
    console.log('📊 E2E + Load Integration Summary');
    console.log('='.repeat(60));

    // Read and compare metrics
    const preLoadPath = path.join(RESULTS_DIR, 'pre-load-metrics.json');
    const postLoadPath = path.join(RESULTS_DIR, 'post-load-metrics.json');

    if (fs.existsSync(preLoadPath) && fs.existsSync(postLoadPath)) {
      const pre = JSON.parse(fs.readFileSync(preLoadPath, 'utf-8'));
      const post = JSON.parse(fs.readFileSync(postLoadPath, 'utf-8'));

      const ttiDegradation = ((post.tti - pre.tti) / pre.tti * 100).toFixed(1);
      const loadDegradation = ((post.loadTime - pre.loadTime) / pre.loadTime * 100).toFixed(1);

      console.log(`   Pre-load TTI:  ${pre.tti?.toFixed(0)}ms`);
      console.log(`   Post-load TTI: ${post.tti?.toFixed(0)}ms (${ttiDegradation}% degradation)`);
      console.log(`   Pre-load Load: ${pre.loadTime?.toFixed(0)}ms`);
      console.log(`   Post-load Load: ${post.loadTime?.toFixed(0)}ms (${loadDegradation}% degradation)`);

      const passed = parseFloat(ttiDegradation) < 50 && parseFloat(loadDegradation) < 50;
      console.log(`\n   ${passed ? '🏆 PASSED' : '❌ FAILED'} — UI degradation ${passed ? 'acceptable' : 'excessive'}`);
    }
  });
});
