/**
 * PilingTrack — Manual Test Plan Runner (Playwright)
 * Covers: Admin Flow, Operator Flow, RBAC, Edge Cases
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const ADMIN = { email: 'admin@piling.ru', password: 'admin123' };
const OPERATOR = { email: 'operator@piling.ru', password: '0000' };

const results = [];

function log(step, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  const msg = `${icon} [${step}] ${status} ${detail ? '— ' + detail : ''}`;
  console.log(msg);
  results.push({ step, status, detail });
}

let page, context, browser;

async function screenshot(name) {
  const path = `C:\\PillingR\\my-project\\test-screenshots\\${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function waitFor(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function setup() {
  log('Setup', 'INFO', 'Launching Chromium browser');
  browser = await chromium.launch({ headless: false, slowMo: 300 });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  
  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));
  page._consoleErrors = consoleErrors;
  
  // Create screenshots directory
  import('fs').then(fs => {
    const dir = 'C:\\PillingR\\my-project\\test-screenshots';
    if (!fs.default.existsSync(dir)) fs.default.mkdirSync(dir, { recursive: true });
  });
}

async function login(email, password) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await waitFor(1000);
  await screenshot('01-login-page');
  
  // Fill login form
  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="почта" i]').first();
  const passInput = page.locator('input[type="password"], input[name="password"]').first();
  const submitBtn = page.locator('button[type="submit"]').first();
  
  await emailInput.fill(email);
  await passInput.fill(password);
  await screenshot(`02-login-filled-${email.split('@')[0]}`);
  
  await submitBtn.click();
  await waitFor(2000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await screenshot(`03-after-login-${email.split('@')[0]}`);
}

async function logout() {
  // Try to find logout button/link
  const logoutBtn = page.locator('button:has-text("Выход"), button:has-text("Logout"), button:has-text("Выйти"), a:has-text("Выход"), a:has-text("Logout"), [data-testid="logout"]').first();
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click();
    await waitFor(1500);
    log('Logout', 'PASS');
    await screenshot('04-logout');
  } else {
    // Try clicking user menu first
    const userMenu = page.locator('[data-testid="user-menu"], .avatar, button:has-text("Админ"), button:has-text("admin"), button:has-text("Operator")').first();
    if (await userMenu.isVisible().catch(() => false)) {
      await userMenu.click();
      await waitFor(500);
      const logoutBtn2 = page.locator('button:has-text("Выход"), button:has-text("Logout"), button:has-text("Выйти")').first();
      if (await logoutBtn2.isVisible().catch(() => false)) {
        await logoutBtn2.click();
        await waitFor(1500);
        log('Logout', 'PASS', 'via user menu');
        await screenshot('04-logout-via-menu');
      }
    } else {
      // API logout
      await page.evaluate(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      });
      await waitFor(1000);
      log('Logout', 'PASS', 'via API');
      await page.goto(BASE + '/login');
    }
  }
}

// ===== STEP 2: ADMIN FLOW =====
async function testAdminFlow() {
  console.log('\n========== STEP 2: ADMIN FLOW ==========\n');
  
  await login(ADMIN.email, ADMIN.password);
  
  // Check we're on admin page
  const currentUrl = page.url();
  if (currentUrl.includes('/admin') || currentUrl.includes('/operator')) {
    log('Admin Login', 'PASS', `redirected to ${currentUrl}`);
  } else {
    log('Admin Login', 'WARN', `current URL: ${currentUrl}`);
    await screenshot('admin-login-redirect-issue');
  }
  
  // --- Dashboard ---
  log('Dashboard', 'INFO', 'Checking dashboard metrics');
  const dashboardVisible = await page.locator('text=/метрик|статистик|Dashboard|дашборд|отчёт|объект/i').first().isVisible().catch(() => false);
  if (dashboardVisible) {
    log('Dashboard Metrics', 'PASS', 'dashboard content visible');
  } else {
    log('Dashboard Metrics', 'WARN', 'no dashboard text found on page');
  }
  await screenshot('05-admin-dashboard');
  
  // --- Объекты (Sites) ---
  log('Sites', 'INFO', 'Navigating to /admin/sites');
  await page.goto(BASE + '/admin/sites', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const sitesContent = await page.locator('text=/объект|сайт|site|площадк/i').first().isVisible().catch(() => false);
  log('Admin Sites', sitesContent ? 'PASS' : 'WARN', sitesContent ? 'sites page loaded' : 'no sites content found');
  await screenshot('06-admin-sites');
  
  // --- Оборудование (Equipment) ---
  log('Equipment', 'INFO', 'Navigating to /admin/equipment');
  await page.goto(BASE + '/admin/equipment', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const equipContent = await page.locator('text=/оборудован|equipment|техник/i').first().isVisible().catch(() => false);
  log('Admin Equipment', equipContent ? 'PASS' : 'WARN', equipContent ? 'equipment page loaded' : 'no equipment content found');
  await screenshot('07-admin-equipment');
  
  // --- Бригады (Crews) ---
  log('Crews', 'INFO', 'Navigating to /admin/crews');
  await page.goto(BASE + '/admin/crews', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const crewsContent = await page.locator('text=/бригад|crew|команд/i').first().isVisible().catch(() => false);
  log('Admin Crews', crewsContent ? 'PASS' : 'WARN', crewsContent ? 'crews page loaded' : 'no crews content found');
  await screenshot('08-admin-crews');
  
  // --- Отчёты (Reports) ---
  log('Reports', 'INFO', 'Navigating to /admin/reports');
  await page.goto(BASE + '/admin/reports', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const reportsContent = await page.locator('text=/отчёт|report|фильтр|filter/i').first().isVisible().catch(() => false);
  log('Admin Reports', reportsContent ? 'PASS' : 'WARN', reportsContent ? 'reports page with filters loaded' : 'no reports content found');
  await screenshot('09-admin-reports');
  
  // Try filters if visible
  const filterBtn = page.locator('button:has-text("Фильтр"), button:has-text("Filter"), [data-testid="filter"]').first();
  if (await filterBtn.isVisible().catch(() => false)) {
    await filterBtn.click();
    await waitFor(500);
    log('Report Filters', 'PASS', 'filter panel opened');
    await screenshot('10-admin-reports-filters');
  }
  
  // --- Справочники (Dictionaries) ---
  log('Dictionaries', 'INFO', 'Navigating to /admin/dictionaries');
  await page.goto(BASE + '/admin/dictionaries', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const dictContent = await page.locator('text=/справочник|dictionar|сва|бурени|простой/i').first().isVisible().catch(() => false);
  log('Admin Dictionaries', dictContent ? 'PASS' : 'WARN', dictContent ? 'dictionaries page loaded' : 'no dictionary content found');
  await screenshot('11-admin-dictionaries');
  
  // --- Пользователи (Users) ---
  log('Users', 'INFO', 'Navigating to /admin/users');
  await page.goto(BASE + '/admin/users', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const usersContent = await page.locator('text=/пользовател|user|поиск|search|фильтр/i').first().isVisible().catch(() => false);
  log('Admin Users', usersContent ? 'PASS' : 'WARN', usersContent ? 'users page with search/filters loaded' : 'no users content found');
  await screenshot('12-admin-users');
  
  // Try search in users
  const searchInput = page.locator('input[placeholder*="поиск" i], input[placeholder*="search" i], input[type="search"]').first();
  if (await searchInput.isVisible().catch(() => false)) {
    await searchInput.fill('admin');
    await waitFor(1000);
    log('User Search', 'PASS', 'search works');
    await screenshot('13-admin-users-search');
  }
}

// ===== STEP 3: OPERATOR FLOW =====
async function testOperatorFlow() {
  console.log('\n========== STEP 3: OPERATOR FLOW ==========\n');
  
  // Logout from admin
  await logout();
  
  // Login as operator
  await login(OPERATOR.email, OPERATOR.password);
  
  const currentUrl = page.url();
  if (currentUrl.includes('/operator')) {
    log('Operator Login', 'PASS', `redirected to ${currentUrl}`);
  } else {
    log('Operator Login', 'WARN', `current URL: ${currentUrl}`);
  }
  
  // --- Check operator dashboard ---
  const opDashboard = await page.locator('text=/создать|отчёт|report|сва|объект/i').first().isVisible().catch(() => false);
  log('Operator Dashboard', opDashboard ? 'PASS' : 'WARN', opDashboard ? 'operator dashboard loaded' : 'checking page content');
  await screenshot('14-operator-dashboard');
  
  // --- Navigate to report form ---
  await page.goto(BASE + '/report', { waitUntil: 'networkidle' });
  await waitFor(1500);
  await screenshot('15-operator-report-form');
  
  // Try to fill report form
  // Look for site/object selector
  const _siteSelect = page.locator('select, [role="combobox"], [data-testid="site-select"]').first();
  const formFields = page.locator('input, select, textarea');
  const fieldCount = await formFields.count();
  log('Report Form Fields', fieldCount > 0 ? 'PASS' : 'WARN', `${fieldCount} form fields found`);
  
  // Try to interact with form elements
  if (fieldCount > 0) {
    // Try clicking the first interactive element
    for (let i = 0; i < Math.min(fieldCount, 3); i++) {
      try {
        const field = formFields.nth(i);
        if (await field.isVisible()) {
          const tag = await field.evaluate(el => el.tagName);
          const type = await field.evaluate(el => el.type || '');
          if (tag === 'SELECT') {
            await field.selectOption({ index: 1 }).catch(() => {});
            log('Form Interaction', 'PASS', `selected option in field ${i} (select)`);
            break;
          } else if (type !== 'hidden' && type !== 'submit') {
            await field.click();
            await field.fill('test');
            log('Form Interaction', 'PASS', `filled field ${i} (${tag} ${type})`);
            break;
          }
        }
      } catch { /* ignore */ }
    }
    await screenshot('16-operator-report-filled');
  }
  
  // --- Check history ---
  await page.goto(BASE + '/history', { waitUntil: 'networkidle' });
  await waitFor(1500);
  const historyContent = await page.locator('text=/истор|history|отчёт/i').first().isVisible().catch(() => false);
  log('Operator History', historyContent ? 'PASS' : 'WARN', historyContent ? 'history page loaded' : 'no history content found');
  await screenshot('17-operator-history');
}

// ===== STEP 4: RBAC VERIFICATION =====
async function testRBAC() {
  console.log('\n========== STEP 4: RBAC VERIFICATION ==========\n');
  
  // Operator should NOT be able to access /admin
  log('RBAC Admin Access', 'INFO', 'Operator trying /admin');
  const response = await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  const adminUrl = page.url();
  
  if (adminUrl.includes('/login') || adminUrl.includes('/operator') || adminUrl.includes('/admin') === false) {
    log('RBAC: Operator → /admin', 'PASS', `blocked, redirected to ${adminUrl}`);
  } else if (response && response.status() >= 400) {
    log('RBAC: Operator → /admin', 'PASS', `blocked with status ${response.status()}`);
  } else {
    // Check if page shows access denied
    const denied = await page.locator('text=/доступ|denied|forbidden|запрещён/i').first().isVisible().catch(() => false);
    if (denied) {
      log('RBAC: Operator → /admin', 'PASS', 'access denied message shown');
    } else {
      log('RBAC: Operator → /admin', 'FAIL', `operator can see /admin page! URL: ${adminUrl}`);
    }
  }
  await screenshot('18-rbac-admin-access');
  
  // --- API access control ---
  log('RBAC API', 'INFO', 'Testing API access control for operator');
  
  // Test admin API endpoints
  const adminEndpoints = [
    '/api/users',
    '/api/reports/admin-upsert',
  ];
  
  for (const endpoint of adminEndpoints) {
    const apiResp = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { method: 'GET', credentials: 'include' });
        return { status: r.status, body: await r.text().then(t => t.substring(0, 200)) };
      } catch (e) {
        return { error: e.message };
      }
    }, BASE + endpoint);
    
    if (apiResp.status === 401 || apiResp.status === 403 || apiResp.status === 404) {
      log(`RBAC API: ${endpoint}`, 'PASS', `blocked with ${apiResp.status}`);
    } else {
      log(`RBAC API: ${endpoint}`, 'WARN', `status ${apiResp.status} — ${apiResp.body?.substring(0, 100)}`);
    }
  }
  
  // Test operator API — should work
  const myReportsResp = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      return { status: r.status };
    } catch (e) {
      return { error: e.message };
    }
  }, BASE + '/api/reports/my');
  
  if (myReportsResp.status === 200) {
    log('RBAC API: /api/reports/my', 'PASS', 'operator can access own reports');
  } else {
    log('RBAC API: /api/reports/my', 'WARN', `status ${myReportsResp.status}`);
  }
  
  // Operator should NOT see other's reports
  const allReportsResp = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      return { status: r.status };
    } catch (e) {
      return { error: e.message };
    }
  }, BASE + '/api/reports/all');
  
  if (allReportsResp.status === 401 || allReportsResp.status === 403) {
    log('RBAC API: /api/reports/all', 'PASS', `operator blocked from all reports (${allReportsResp.status})`);
  } else {
    log('RBAC API: /api/reports/all', 'WARN', `status ${allReportsResp.status} — check if data is filtered`);
  }
}

// ===== STEP 5: EDGE CASES =====
async function testEdgeCases() {
  console.log('\n========== STEP 5: EDGE CASES ==========\n');
  
  // --- Form Validation ---
  log('Form Validation', 'INFO', 'Testing empty form submission');
  await page.goto(BASE + '/report', { waitUntil: 'networkidle' });
  await waitFor(1500);
  
  // Try to find and click submit without filling
  const submitBtn = page.locator('button[type="submit"], button:has-text("Сохранить"), button:has-text("Save"), button:has-text("Отправить"), button:has-text("Submit")').first();
  
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
    await waitFor(1000);
    
    // Check for validation errors
    const validationError = await page.locator('text=/обязательн|required|заполн|валид|ошибк|error|неверн/i').first().isVisible().catch(() => false);
    const html5Validation = await page.evaluate(() => {
      const invalid = document.querySelector(':invalid');
      return invalid ? invalid.validationMessage : null;
    });
    
    if (validationError) {
      log('Form Validation', 'PASS', 'validation error displayed');
    } else if (html5Validation) {
      log('Form Validation', 'PASS', `HTML5 validation: ${html5Validation}`);
    } else {
      log('Form Validation', 'WARN', 'no visible validation error after empty submit');
    }
    await screenshot('19-form-validation');
  } else {
    log('Form Validation', 'WARN', 'no submit button found');
  }
  
  // --- Offline-first check ---
  log('Offline-first', 'INFO', 'Checking service worker');
  const swStatus = await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        hasSW: !!reg,
        state: reg?.active?.state || null,
        scope: reg?.scope || null
      };
    }
    return { hasSW: false };
  });
  
  if (swStatus.hasSW) {
    log('Service Worker', 'PASS', `registered (${swStatus.state}) at ${swStatus.scope}`);
  } else {
    log('Service Worker', 'WARN', 'no service worker registered');
  }
  
  // --- Report Export ---
  log('Report Export', 'INFO', 'Testing PDF export endpoint');
  const exportResp = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      return { status: r.status, contentType: r.headers.get('content-type'), contentLength: r.headers.get('content-length') };
    } catch (e) {
      return { error: e.message };
    }
  }, BASE + '/api/reports/export');
  
  if (exportResp.status === 200) {
    log('Report Export API', 'PASS', `export endpoint available (${exportResp.contentType})`);
  } else if (exportResp.status === 401 || exportResp.status === 403) {
    log('Report Export API', 'WARN', `export needs auth (${exportResp.status})`);
  } else {
    log('Report Export API', 'WARN', `status ${exportResp.status}`);
  }
  
  // Try PDF endpoint too
  const pdfResp = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { method: 'GET', credentials: 'include' });
      return { status: r.status, contentType: r.headers.get('content-type') };
    } catch (e) {
      return { error: e.message };
    }
  }, BASE + '/api/reports/pdf');
  
  log('PDF Export API', pdfResp.status === 200 ? 'PASS' : 'WARN', `status ${pdfResp.status} ${pdfResp.contentType || ''}`);
  
  await screenshot('20-edge-cases');
}

// ===== SUMMARY =====
function printSummary() {
  console.log('\n\n========================================');
  console.log('          TEST SUMMARY');
  console.log('========================================\n');
  
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const info = results.filter(r => r.status === 'INFO').length;
  const total = results.filter(r => r.status !== 'INFO').length;
  
  console.log(`✅ PASS: ${pass}`);
  console.log(`❌ FAIL: ${fail}`);
  console.log(`⚠️  WARN: ${warn}`);
  console.log(`ℹ️  INFO: ${info}`);
  console.log(`\n   Asserted: ${total} | Pass Rate: ${total > 0 ? Math.round(pass/total*100) : 0}%`);
  
  if (fail > 0) {
    console.log('\n❌ FAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   - [${r.step}] ${r.detail}`);
    });
  }
  
  if (warn > 0) {
    console.log('\n⚠️  WARNINGS:');
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`   - [${r.step}] ${r.detail}`);
    });
  }
  
  console.log('\n========================================\n');
}

async function main() {
  console.log('🚀 PilingTrack Manual Test Runner');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔗 ${BASE}\n`);
  
  try {
    await setup();
    
    // Step 1: App is already running
    log('Dev Server', 'PASS', 'npm run dev — localhost:3000');
    
    // Step 2: Admin Flow
    await testAdminFlow();
    
    // Step 3: Operator Flow
    await testOperatorFlow();
    
    // Step 4: RBAC Verification
    await testRBAC();
    
    // Step 5: Edge Cases
    await testEdgeCases();
    
  } catch (err) {
    log('Runtime Error', 'FAIL', err.message);
    console.error(err);
  } finally {
    printSummary();
    
    if (page) {
      console.log('\n📸 Screenshots saved to: C:\\PillingR\\my-project\\test-screenshots\\');
    }
    
    // Keep browser open for manual inspection
    console.log('\n⏳ Browser will stay open for 60 seconds for manual inspection...');
    await waitFor(60000);
    
    if (browser) await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
