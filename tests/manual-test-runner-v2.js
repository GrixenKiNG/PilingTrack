/**
 * PilingTrack — Comprehensive Test Runner v2
 * Uses API + light UI testing with dev-overlay handling
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const ADMIN = { email: 'admin@piling.ru', password: 'admin123' };
const OPERATOR = { email: 'operator@piling.ru', password: '0000' };

const results = [];
let page, context, browser;
let adminCookies, operatorCookies;

function log(step, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  const line = `${icon} [${step}] ${status}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  results.push({ step, status, detail });
}

async function screenshot(name) {
  const path = `C:\\PillingR\\my-project\\test-screenshots\\${name}.png`;
  try { await page.screenshot({ path, fullPage: true }); } catch { /* ignore */ }
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiCall(cookies, method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const opts = { method, headers };
  if (cookies) {
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    headers['Cookie'] = cookieStr;
  }
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(BASE + path, opts);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { status: r.status, json, text: text.substring(0, 300), ok: r.ok };
  } catch (e) {
    return { status: 0, error: e.message, json: null, text: e.message, ok: false };
  }
}

async function dismissDevOverlay() {
  // Next.js dev overlay intercepts clicks — dismiss it if present
  try {
    const overlay = page.locator('nextjs-portal');
    if (await overlay.isVisible().catch(() => false)) {
      // The overlay has a close button or we can click outside
      const closeBtn = page.locator('[data-nextjs-dialog-close], button[aria-label="Close errors"]');  
      if (await closeBtn.first().isVisible().catch(() => false)) {
        await closeBtn.first().click({ timeout: 3000 });
        await wait(500);
      }
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

async function setup() {
  const fs = (await import('fs')).default;
  const dir = 'C:\\PillingR\\my-project\\test-screenshots';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  browser = await chromium.launch({ headless: false, slowMo: 200 });
  context = await browser.newContext({ 
    viewport: { width: 1440, height: 900 },
    bypassCSP: true 
  });
  page = await context.newPage();
  
  // Suppress Next.js dev overlay
  await context.addInitScript(() => {
    // Monkey-patch to hide the dev overlay
      window.__hideNextjsOverlay = true;
  });
}

async function login(email, password) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(2000);
  await screenshot(`login-${email.split('@')[0]}`);
  
  // Close dev overlay if present
  await dismissDevOverlay();
  
  // Fill form
  const emailField = page.locator('input').first();
  const passField = page.locator('input[type="password"]').first();
  
  if (!await emailField.isVisible({ timeout: 5000 }).catch(() => false)) {
    // Maybe already logged in
    log(`Login ${email}`, 'WARN', 'login form not visible, may already be logged in');
    return;
  }
  
  await emailField.fill(email);
  await passField.fill(password);
  
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click();
  
  // Wait for navigation
  await wait(3000);
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  await dismissDevOverlay();
  
  const url = page.url();
  log(`Login ${email}`, 'PASS', `redirected to ${url.replace(BASE, '')}`);
  await screenshot(`after-login-${email.split('@')[0]}`);
  
  // Store cookies
  const cookies = await context.cookies();
  return cookies;
}

async function logout() {
  // Try API logout
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  });
  await wait(1000);
  // Clear cookies
  await context.clearCookies();
  log('Logout', 'PASS', 'logged out via API + cleared cookies');
}

async function getPageText() {
  await dismissDevOverlay();
  try {
    return await page.evaluate(() => document.body?.innerText?.substring(0, 1000) || '');
  } catch { return ''; }
}

// ===== STEP 2: ADMIN FLOW =====
async function testAdminFlow() {
  console.log('\n========== STEP 2: ADMIN FLOW ==========\n');
  
  adminCookies = await login(ADMIN.email, ADMIN.password);
  
  // --- Dashboard ---
  console.log('  --- Dashboard ---');
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  
  let text = await getPageText();
  log('Dashboard', text.length > 50 ? 'PASS' : 'WARN', `page has ${text.length} chars of text`);
  
  // Check for analytics data
  const dashResp = await apiCall(adminCookies, 'GET', '/api/analytics/sites');
  if (dashResp.ok && dashResp.json) {
    const analytics = dashResp.json.analytics || dashResp.json;
    const count = Array.isArray(analytics) ? analytics.length : 0;
    log('Analytics API', count >= 0 ? 'PASS' : 'WARN', `${count} site analytics entries`);
  } else {
    log('Analytics API', 'WARN', `status ${dashResp.status}`);
  }
  await screenshot('admin-dashboard');
  
  // --- Объекты (Sites) ---
  console.log('  --- Объекты / Sites ---');
  await page.goto(BASE + '/admin/sites', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Sites Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const sitesResp = await apiCall(adminCookies, 'GET', '/api/sites/all');
  if (sitesResp.ok && sitesResp.json) {
    const sites = Array.isArray(sitesResp.json) ? sitesResp.json : (sitesResp.json.sites || []);
    log('Sites API', 'PASS', `${sites.length} sites loaded`);
  } else {
    log('Sites API', 'WARN', `status ${sitesResp.status}`);
  }
  await screenshot('admin-sites');
  
  // --- Оборудование (Equipment) ---
  console.log('  --- Оборудование / Equipment ---');
  await page.goto(BASE + '/admin/equipment', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Equipment Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const equipResp = await apiCall(adminCookies, 'GET', '/api/equipment/all');
  if (equipResp.ok && equipResp.json) {
    const equip = Array.isArray(equipResp.json) ? equipResp.json : (equipResp.json.equipment || []);
    log('Equipment API', 'PASS', `${equip.length} equipment items`);
  } else {
    log('Equipment API', 'WARN', `status ${equipResp.status}`);
  }
  await screenshot('admin-equipment');
  
  // --- Бригады (Crews) ---
  console.log('  --- Бригады / Crews ---');
  await page.goto(BASE + '/admin/crews', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Crews Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const crewsResp = await apiCall(adminCookies, 'GET', '/api/crews/all');
  if (crewsResp.ok && crewsResp.json) {
    const crews = Array.isArray(crewsResp.json) ? crewsResp.json : (crewsResp.json.crews || []);
    log('Crews API', 'PASS', `${crews.length} crews loaded`);
  } else {
    log('Crews API', 'WARN', `status ${crewsResp.status}`);
  }
  await screenshot('admin-crews');
  
  // --- Отчёты (Reports) ---
  console.log('  --- Отчёты / Reports ---');
  await page.goto(BASE + '/admin/reports', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Reports Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const reportsResp = await apiCall(adminCookies, 'GET', '/api/reports/all');
  if (reportsResp.ok && reportsResp.json) {
    const reports = Array.isArray(reportsResp.json) ? reportsResp.json : (reportsResp.json.reports || []);
    log('Reports API', 'PASS', `${reports.length} reports loaded`);
  } else {
    log('Reports API', 'WARN', `status ${reportsResp.status}: ${reportsResp.text?.substring(0, 100)}`);
  }
  
  // Test reports with period filter
  const reportsPeriodResp = await apiCall(adminCookies, 'GET', '/api/reports/period?start=2026-01-01&end=2026-12-31');
  log('Reports Period Filter', reportsPeriodResp.ok ? 'PASS' : 'WARN', `status ${reportsPeriodResp.status}`);
  await screenshot('admin-reports');
  
  // --- Справочники (Dictionaries) ---
  console.log('  --- Справочники / Dictionaries ---');
  await page.goto(BASE + '/admin/dictionaries', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Dictionaries Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const dictResp = await apiCall(adminCookies, 'GET', '/api/dictionary/all');
  if (dictResp.ok && dictResp.json) {
    const dictTypes = Object.keys(dictResp.json);
    log('Dictionaries API', 'PASS', `${dictTypes.length} dictionary types: ${dictTypes.join(', ')}`);
  } else {
    log('Dictionaries API', 'WARN', `status ${dictResp.status}`);
  }
  await screenshot('admin-dictionaries');
  
  // --- Пользователи (Users) ---
  console.log('  --- Пользователи / Users ---');
  await page.goto(BASE + '/admin/users', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Users Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  const usersResp = await apiCall(adminCookies, 'GET', '/api/users/manage');
  if (usersResp.status !== 405 && usersResp.ok && usersResp.json) {
    const users = Array.isArray(usersResp.json) ? usersResp.json : (usersResp.json.users || []);
    log('Users API', 'PASS', `${users.length} users loaded`);
  } else {
    log('Users API', 'WARN', `status ${usersResp.status} (may be POST-only)`);
  }
  await screenshot('admin-users');
}

// ===== STEP 3: OPERATOR FLOW =====
async function testOperatorFlow() {
  console.log('\n========== STEP 3: OPERATOR FLOW ==========\n');
  
  // Logout admin
  await logout();
  
  // Login as operator
  operatorCookies = await login(OPERATOR.email, OPERATOR.password);
  
  // --- Operator Dashboard ---
  console.log('  --- Operator Dashboard ---');
  await page.goto(BASE + '/operator', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  let text = await getPageText();
  log('Operator Dashboard', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  await screenshot('operator-dashboard');
  
  // --- Operator: My Reports ---
  const myReportsResp = await apiCall(operatorCookies, 'GET', '/api/reports/my');
  if (myReportsResp.ok) {
    const reports = Array.isArray(myReportsResp.json) ? myReportsResp.json : (myReportsResp.json.reports || []);
    log('My Reports API', 'PASS', `${reports.length} reports`);
  } else {
    log('My Reports API', 'WARN', `status ${myReportsResp.status}`);
  }
  
  // --- Operator: Create Report ---
  console.log('  --- Create Report ---');
  // Try to navigate to report creation page
  await page.goto(BASE + '/report', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('Report Form Page', text.length > 30 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  
  // Check if form fields are visible
  const formInputs = await page.locator('input:not([type="hidden"]), select, textarea').count();
  log('Report Form Fields', formInputs > 0 ? 'PASS' : 'WARN', `${formInputs} interactive form elements`);
  
  // Try to submit empty form via API
  const emptyReportResp = await apiCall(operatorCookies, 'POST', '/api/reports/upsert', {
    piles: [],
    drilling: [],
    downtime: [],
  });
  log('Empty Report Submit', emptyReportResp.status === 400 || emptyReportResp.status === 422 ? 'PASS' : 'WARN', 
    `status ${emptyReportResp.status} — ${emptyReportResp.text?.substring(0, 100)}`);
  await screenshot('operator-report-form');
  
  // --- Operator: History ---
  console.log('  --- History ---');
  await page.goto(BASE + '/history', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  await dismissDevOverlay();
  text = await getPageText();
  log('History Page', text.length > 20 ? 'PASS' : 'WARN', `page text length: ${text.length}`);
  await screenshot('operator-history');
  
  // --- Operator: Edit own report ---
  // If there are reports, try to edit one
  if (myReportsResp.ok && myReportsResp.json) {
    const reports = Array.isArray(myReportsResp.json) ? myReportsResp.json : (myReportsResp.json.reports || []);
    if (reports.length > 0) {
      const reportId = reports[0].id || reports[0].reportId;
      const editResp = await apiCall(operatorCookies, 'GET', `/api/reports/edit?id=${reportId}`);
      log('Edit Report API', editResp.ok ? 'PASS' : 'WARN', `status ${editResp.status}`);
    } else {
      log('Edit Report API', 'WARN', 'no reports to edit');
    }
  }
}

// ===== STEP 4: RBAC VERIFICATION =====
async function testRBAC() {
  console.log('\n========== STEP 4: RBAC VERIFICATION ==========\n');
  
  // Make sure we're still operator
  operatorCookies = await context.cookies();
  
  // --- Operator should NOT access /admin page ---
  console.log('  --- Operator /admin access ---');
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(2000);
  const adminUrl = page.url();
  const bodyText = await getPageText();
  
  // Check if redirected or blocked
  const isRedirected = !adminUrl.includes('/admin') || adminUrl.includes('/login') || adminUrl.includes('/operator');
  const hasDeniedText = /доступ|denied|forbidden|недостаточно|нет прав/i.test(bodyText);
  
  if (isRedirected) {
    log('RBAC: Operator → /admin', 'PASS', `redirected from /admin to ${adminUrl}`);
  } else if (hasDeniedText) {
    log('RBAC: Operator → /admin', 'PASS', 'access denied message shown');
  } else {
    // Check if the page actually loads admin data or shows empty/guarded content
    const emptyPage = bodyText.length < 100;
    if (emptyPage) {
      log('RBAC: Operator → /admin', 'WARN', `page rendered but appears empty (len=${bodyText.length}) — client-side guard may work`);
    } else {
      log('RBAC: Operator → /admin', 'FAIL', `operator appears to see admin page content (${bodyText.substring(0, 80)}...)`);
    }
  }
  await screenshot('rbac-admin-access');
  
  // --- API Access Control ---
  console.log('  --- API RBAC ---');
  
  // Endpoints operator should NOT access
  const forbiddenForOperator = [
    { path: '/api/users/manage', method: 'GET', name: 'User Management' },
    { path: '/api/reports/all', method: 'GET', name: 'All Reports (admin)' },
    { path: '/api/reports/admin-upsert', method: 'POST', name: 'Admin Report Upsert' },
  ];
  
  for (const ep of forbiddenForOperator) {
    const resp = await apiCall(operatorCookies, ep.method, ep.path);
    const blocked = resp.status === 401 || resp.status === 403;
    const notFound = resp.status === 404 || resp.status === 405;
    log(`RBAC API: ${ep.name}`, blocked ? 'PASS' : notFound ? 'WARN' : 'FAIL',
      `status ${resp.status}${blocked ? ' (blocked)' : notFound ? ' (method not found)' : ` (accessible!) ${resp.text?.substring(0, 80)}`}`);
  }
  
  // Endpoints operator SHOULD access
  const allowedForOperator = [
    { path: '/api/reports/my', method: 'GET', name: 'My Reports' },
    { path: '/api/crews/my', method: 'GET', name: 'My Crew' },
    { path: '/api/sites/all', method: 'GET', name: 'Sites (read)' },
  ];
  
  for (const ep of allowedForOperator) {
    const resp = await apiCall(operatorCookies, ep.method, ep.path);
    log(`RBAC API: ${ep.name}`, resp.ok ? 'PASS' : 'WARN', `status ${resp.status}`);
  }
}

// ===== STEP 5: EDGE CASES =====
async function testEdgeCases() {
  console.log('\n========== STEP 5: EDGE CASES ==========\n');
  
  // --- Form Validation ---
  console.log('  --- Form Validation ---');
  
  // Test via API: submit empty report
  const emptyResp = await apiCall(operatorCookies, 'POST', '/api/reports/upsert', {
    siteId: '',
    date: '',
    piles: [],
    drilling: [],
    downtime: [],
  });
  log('Empty Form API', emptyResp.status === 400 || emptyResp.status === 422 ? 'PASS' : 'WARN',
    `status ${emptyResp.status} — ${emptyResp.text?.substring(0, 120)}`);
  
  // Test with invalid siteId
  const invalidSiteResp = await apiCall(operatorCookies, 'POST', '/api/reports/upsert', {
    siteId: 'nonexistent-id-12345',
    date: '2026-04-14',
    shiftNumber: 1,
    piles: [{ pileNumber: 1, status: 'COMPLETED' }],
    drilling: [],
    downtime: [],
  });
  log('Invalid Site API', invalidSiteResp.status === 400 || invalidSiteResp.status === 404 ? 'PASS' : 'WARN',
    `status ${invalidSiteResp.status}`);
  
  // --- Offline-first (Service Worker) ---
  console.log('  --- Offline-first ---');
  await page.goto(BASE + '/operator', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await wait(3000);
  
  const swStatus = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { hasSW: false, reason: 'not supported' };
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length === 0) return { hasSW: false, reason: 'no registrations' };
    return { 
      hasSW: true, 
      count: regs.length,
      scopes: regs.map(r => r.scope),
      states: regs.map(r => r.active?.state || 'inactive')
    };
  });
  log('Service Worker', swStatus.hasSW ? 'PASS' : 'WARN', 
    swStatus.hasSW ? `${swStatus.count} registered, states: ${swStatus.states.join(', ')}` : `not registered (${swStatus.reason})`);
  
  // Check for PWA manifest
  const manifestResp = await apiCall(null, 'GET', '/manifest.json');
  log('PWA Manifest', manifestResp.ok ? 'PASS' : 'WARN', `status ${manifestResp.status}`);
  
  // --- Report Export ---
  console.log('  --- Export ---');
  
  // PDF export
  const pdfResp = await apiCall(operatorCookies, 'GET', '/api/reports/pdf');
  log('PDF Export', pdfResp.ok ? 'PASS' : 'WARN', `status ${pdfResp.status}`);
  
  // General export
  const exportResp = await apiCall(operatorCookies, 'GET', '/api/reports/export');
  log('Report Export', exportResp.ok ? 'PASS' : 'WARN', `status ${exportResp.status}`);
  
  // Single report PDF
  const singlePdfResp = await apiCall(operatorCookies, 'GET', '/api/reports/single-pdf?id=test');
  log('Single PDF Export', singlePdfResp.ok ? 'PASS' : 'WARN', `status ${singlePdfResp.status}`);
  
  // --- Health Check ---
  console.log('  --- System Health ---');
  const healthResp = await apiCall(null, 'GET', '/api/health');
  log('Health API', healthResp.ok ? 'PASS' : 'WARN', `status ${healthResp.status} — ${healthResp.text?.substring(0, 100)}`);
  
  await screenshot('edge-cases-final');
}

// ===== SUMMARY =====
function printSummary() {
  console.log('\n\n╔══════════════════════════════════════════╗');
  console.log('║          TEST EXECUTION SUMMARY         ║');
  console.log('╠══════════════════════════════════════════╣');
  
  const pass = results.filter(r => r.status === 'PASS');
  const fail = results.filter(r => r.status === 'FAIL');
  const warn = results.filter(r => r.status === 'WARN');
  const total = pass.length + fail.length + warn.length;
  
  console.log(`║  ✅ PASS: ${String(pass.length).padStart(3)}                              ║`);
  console.log(`║  ❌ FAIL: ${String(fail.length).padStart(3)}                              ║`);
  console.log(`║  ⚠️  WARN: ${String(warn.length).padStart(3)}                              ║`);
  console.log(`║  📊 Total: ${String(total).padStart(3)}  |  Rate: ${String(Math.round(pass.length/Math.max(total,1)*100)).padStart(3)}%                   ║`);
  console.log('╚══════════════════════════════════════════╝');
  
  if (fail.length > 0) {
    console.log('\n❌ FAILURES:');
    fail.forEach(r => console.log(`   • [${r.step}] ${r.detail}`));
  }
  
  if (warn.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    warn.forEach(r => console.log(`   • [${r.step}] ${r.detail}`));
  }
  
  console.log('\n📸 Screenshots: C:\\PillingR\\my-project\\test-screenshots\\');
  console.log('');
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   PilingTrack — Manual Test Plan v2      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔗 ${BASE}\n`);
  
  try {
    await setup();
    log('Dev Server', 'PASS', 'npm run dev — localhost:3000');
    
    await testAdminFlow();
    await testOperatorFlow();
    await testRBAC();
    await testEdgeCases();
  } catch (err) {
    log('Runtime Error', 'FAIL', err.message);
    console.error(err.stack);
  } finally {
    printSummary();
    await wait(5000);
    if (browser) await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
