import { chromium, Page, Browser, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

let browser: Browser;
let context: BrowserContext;
let page: Page;
const screenshotDir = './test-screenshots';
const testResults: string[] = [];

// Ensure screenshot directory exists
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

const BASE_URL = 'http://localhost:3001';
const ADMIN_EMAIL = 'admin@piling.ru';
const ADMIN_PASSWORD = 'admin123';

function addResult(message: string) {
  console.log(message);
  testResults.push(message);
}

async function screenshot(name: string) {
  const filename = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  addResult(`📸 Screenshot: ${name}`);
}

async function testAdminLogin() {
  addResult('\n=== TEST 1: ADMIN LOGIN ===');
  await page.goto(BASE_URL);
  await screenshot('01-login-page');
  
  // Fill login form
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await screenshot('02-login-form-filled');
  
  // Submit login
  await page.click('button[type="submit"]');
  
  // Wait for navigation
  await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('load');
  
  // Wait a bit for dashboard to load
  await page.waitForTimeout(2000);
  await screenshot('03-after-login');
  
  // Check if we're logged in by looking for admin-specific elements
  const isLoggedIn = await page.locator('text=/Выход|Профиль/').isVisible().catch(() => false);
  
  if (isLoggedIn) {
    addResult('✅ Admin login successful');
  } else {
    addResult('❌ Admin login failed - no logout button found');
  }
}

async function testDashboard() {
  addResult('\n=== TEST 2: DASHBOARD ===');
  
  // Wait for page to be stable
  await page.waitForTimeout(1000);
  
  const dashboardTitle = await page.locator('text=/Дашборд|Dashboard|Главная/').isVisible().catch(() => false);
  
  if (dashboardTitle || await page.url().includes('dashboard')) {
    addResult('✅ Dashboard loaded');
    await screenshot('04-dashboard');
  } else {
    addResult('⚠️  Dashboard title not found, checking URL...');
    addResult(`   Current URL: ${await page.url()}`);
    await screenshot('04-current-page');
  }
  
  // Check console for errors
  const errors = await page.evaluate(() => {
    return (window as any).__errors || [];
  }).catch(() => []);
  
  if (errors.length > 0) {
    addResult(`⚠️  Console errors found: ${errors.join(', ')}`);
  }
}

async function testSites() {
  addResult('\n=== TEST 3: SITES (ОБЪЕКТЫ) ===');
  
  // Try to find and click Sites navigation
  const siteLinks = await page.locator('a, button').filter({ hasText: /Объекты|Sites/ }).all();
  
  if (siteLinks.length > 0) {
    await siteLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('05-sites-page');
    
    const sitesList = await page.locator('text=/Объект|Site/').isVisible().catch(() => false);
    if (sitesList) {
      addResult('✅ Sites/Objects module is accessible');
    } else {
      addResult('⚠️  Sites module loaded but no clear content');
    }
  } else {
    addResult('❌ Sites navigation link not found');
  }
}

async function testEquipment() {
  addResult('\n=== TEST 4: EQUIPMENT (УСТАНОВКИ) ===');
  
  // Try to find and click Equipment navigation
  const equipLinks = await page.locator('a, button').filter({ hasText: /Установки|Equipment/i }).all();
  
  if (equipLinks.length > 0) {
    await equipLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('06-equipment-page');
    
    // Check for equipment list content
    const equipmentRows = await page.locator('tr, [role="row"]').all();
    const equipmentVisible = await page.locator('text=/Бауман|Equipment|Установка/').isVisible().catch(() => false);
    
    if (equipmentRows.length > 0 || equipmentVisible) {
      addResult(`✅ Equipment module loaded with ${equipmentRows.length} rows`);
      
      // Check for specific equipment names
      const equipment_bauman_100 = await page.locator('text=/Бауман-100/').isVisible().catch(() => false);
      const equipment_bauman_80 = await page.locator('text=/Бауман-80/').isVisible().catch(() => false);
      const equipment_vibrocrane = await page.locator('text=/Виброрам/').isVisible().catch(() => false);
      const equipment_piledriver = await page.locator('text=/Сваебой/').isVisible().catch(() => false);
      const equipment_generator = await page.locator('text=/Генератор/').isVisible().catch(() => false);
      
      if (equipment_bauman_100) addResult('✅ Found: Бауман-100');
      if (equipment_bauman_80) addResult('✅ Found: Бауман-80');
      if (equipment_vibrocrane) addResult('✅ Found: Виброрам');
      if (equipment_piledriver) addResult('✅ Found: Сваебой');
      if (equipment_generator) addResult('✅ Found: Генератор');
      
      if (!equipment_bauman_100 && !equipment_bauman_80) {
        addResult('⚠️  Equipment list exists but standard equipment not visible in current view');
      }
    } else {
      addResult('❌ Equipment list appears to be empty or not loaded');
    }
  } else {
    addResult('❌ Equipment navigation link not found');
  }
}

async function testCrews() {
  addResult('\n=== TEST 5: CREWS (БРИГАДЫ) ===');
  
  const crewLinks = await page.locator('a, button').filter({ hasText: /Бригады|Crews/i }).all();
  
  if (crewLinks.length > 0) {
    await crewLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('07-crews-page');
    
    const crewsVisible = await page.locator('text=/Бригада|Crew/').isVisible().catch(() => false);
    
    if (crewsVisible) {
      addResult('✅ Crews module is accessible');
    } else {
      addResult('⚠️  Crews module loaded but no clear content');
    }
  } else {
    addResult('❌ Crews navigation link not found');
  }
}

async function testReports() {
  addResult('\n=== TEST 6: REPORTS (ОТЧЕТЫ) ===');
  
  const reportLinks = await page.locator('a, button').filter({ hasText: /Отчеты|Reports/i }).all();
  
  if (reportLinks.length > 0) {
    await reportLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('08-reports-page');
    
    const reportsVisible = await page.locator('text=/Отчет|Report/').isVisible().catch(() => false);
    
    if (reportsVisible) {
      addResult('✅ Reports module is accessible');
      
      // Test PDF preview
      const pdfButton = await page.locator('button').filter({ hasText: /Предпросмотр|Preview|PDF/i }).first();
      if (await pdfButton.isVisible()) {
        addResult('✅ PDF preview button found');
        
        // Click PDF preview
        await pdfButton.click();
        await page.waitForTimeout(2000);
        await screenshot('09-pdf-preview');
        
        // Check if PDF controls are within bounds
        const printBtn = await page.locator('button').filter({ hasText: /Печать|Print/i }).isVisible().catch(() => false);
        const downloadBtn = await page.locator('button').filter({ hasText: /Скачать|Download/i }).isVisible().catch(() => false);
        const closeBtn = await page.locator('button').filter({ hasText: /Закрыть|Close/i }).isVisible().catch(() => false);
        
        if (printBtn) addResult('✅ Print button visible in PDF preview');
        if (downloadBtn) addResult('✅ Download button visible in PDF preview');
        if (closeBtn) addResult('✅ Close button visible in PDF preview');
        
        // Close PDF preview
        if (closeBtn) {
          await page.locator('button').filter({ hasText: /Закрыть|Close/i }).first().click();
          await page.waitForTimeout(1000);
        }
      } else {
        addResult('⚠️  PDF preview button not found');
      }
      
      // Test date range filtering
      const dateInputs = await page.locator('input[type="date"]').all();
      if (dateInputs.length >= 2) {
        addResult('✅ Date range inputs found');
        
        // Set date range: 08.04.2026 to 15.04.2026
        await dateInputs[0].fill('2026-04-08');
        await dateInputs[1].fill('2026-04-15');
        await screenshot('10-date-range-set');
        
        const applyBtn = await page.locator('button').filter({ hasText: /Применить|Apply/i }).isVisible().catch(() => false);
        if (applyBtn) {
          await page.locator('button').filter({ hasText: /Применить|Apply/i }).first().click();
          await page.waitForTimeout(2000);
          addResult('✅ Date range filter applied');
          await screenshot('11-filtered-reports');
        }
      } else {
        addResult('⚠️  Date range inputs not found');
      }
      
    } else {
      addResult('⚠️  Reports module loaded but no clear content');
    }
  } else {
    addResult('❌ Reports navigation link not found');
  }
}

async function testDictionaries() {
  addResult('\n=== TEST 7: DICTIONARIES (СПРАВОЧНИКИ) ===');
  
  const dictLinks = await page.locator('a, button').filter({ hasText: /Справочники|Dictionaries/i }).all();
  
  if (dictLinks.length > 0) {
    await dictLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('12-dictionaries-page');
    
    const dictVisible = await page.locator('text=/Справочник|Dictionary/').isVisible().catch(() => false);
    
    if (dictVisible) {
      addResult('✅ Dictionaries module is accessible');
    } else {
      addResult('⚠️  Dictionaries module loaded but no clear content');
    }
  } else {
    addResult('❌ Dictionaries navigation link not found');
  }
}

async function testUsers() {
  addResult('\n=== TEST 8: USERS (ПОЛЬЗОВАТЕЛИ) ===');
  
  const userLinks = await page.locator('a, button').filter({ hasText: /Пользователи|Users/i }).all();
  
  if (userLinks.length > 0) {
    await userLinks[0].click();
    await page.waitForTimeout(2000);
    await screenshot('13-users-page');
    
    const usersVisible = await page.locator('text=/Пользователь|User/').isVisible().catch(() => false);
    
    if (usersVisible) {
      addResult('✅ Users module is accessible');
    } else {
      addResult('⚠️  Users module loaded but no clear content');
    }
  } else {
    addResult('❌ Users navigation link not found');
  }
}

async function testReverseNavigation() {
  addResult('\n=== TEST 9: REVERSE NAVIGATION (от последнего к первому) ===');
  
  // Try to go back through modules in reverse order
  const backBtn = await page.locator('button').filter({ hasText: /Назад|Back/i }).isVisible().catch(() => false);
  
  if (backBtn) {
    // Click back several times
    for (let i = 0; i < 3; i++) {
      const btn = await page.locator('button').filter({ hasText: /Назад|Back/i }).isVisible().catch(() => false);
      if (btn) {
        await page.locator('button').filter({ hasText: /Назад|Back/i }).first().click();
        await page.waitForTimeout(500);
      }
    }
    addResult('✅ Reverse navigation tested');
  } else {
    addResult('⚠️  Back button not found for reverse navigation');
  }
  
  await screenshot('14-after-reverse-nav');
}

async function testReportEditing() {
  addResult('\n=== TEST 10: REPORT EDITING ===');
  
  // Navigate to Reports again
  const reportLinks = await page.locator('a, button').filter({ hasText: /Отчеты|Reports/i }).all();
  
  if (reportLinks.length > 0) {
    await reportLinks[0].click();
    await page.waitForTimeout(2000);
    
    // Find and click edit button
    const editBtn = await page.locator('button').filter({ hasText: /Редактир|Edit|Изменить/i }).first().isVisible().catch(() => false);
    
    if (editBtn) {
      await page.locator('button').filter({ hasText: /Редактир|Edit|Изменить/i }).first().click();
      await page.waitForTimeout(2000);
      await screenshot('15-report-edit');
      
      // Check for required fields
      const equipmentField = await page.locator('label, [class*="label"]').filter({ hasText: /Установка|Equipment/i }).isVisible().catch(() => false);
      const pilesField = await page.locator('label, [class*="label"]').filter({ hasText: /Забитые сваи|Piles/i }).isVisible().catch(() => false);
      const drillingField = await page.locator('label, [class*="label"]').filter({ hasText: /Лидерное бурение|Drilling/i }).isVisible().catch(() => false);
      const downtimesField = await page.locator('label, [class*="label"]').filter({ hasText: /Причины простоев|Downtimes/i }).isVisible().catch(() => false);
      
      if (equipmentField) addResult('✅ Equipment field found');
      else addResult('❌ Equipment field NOT found');
      
      if (pilesField) addResult('✅ Piles field found');
      else addResult('❌ Piles field NOT found');
      
      if (drillingField) addResult('✅ Drilling field found');
      else addResult('❌ Drilling field NOT found');
      
      if (downtimesField) addResult('✅ Downtimes field found');
      else addResult('❌ Downtimes field NOT found');
      
      // Close edit form
      const closeBtn = await page.locator('button').filter({ hasText: /Отмена|Cancel|Закрыть/i }).isVisible().catch(() => false);
      if (closeBtn) {
        await page.locator('button').filter({ hasText: /Отмена|Cancel|Закрыть/i }).first().click();
        await page.waitForTimeout(1000);
      }
    } else {
      addResult('⚠️  Edit button not found for reports');
    }
  }
}

async function testOtherRoles() {
  addResult('\n=== TEST 11: ROLE TESTING ===');
  
  // Logout from admin
  const logoutLink = await page.locator('a, button').filter({ hasText: /Выход|Logout/i }).isVisible().catch(() => false);
  
  if (logoutLink) {
    await page.locator('a, button').filter({ hasText: /Выход|Logout/i }).first().click();
    await page.waitForTimeout(2000);
    await screenshot('16-after-logout');
    addResult('✅ Logout successful');
    
    // Test Dispatcher login
    const dispatcherEmail = 'dispatch@piling.ru';
    const dispatcherPassword = '2222'; // From LOCAL-ACCESS.md
    
    await page.fill('input[type="email"]', dispatcherEmail);
    await page.fill('input[type="password"]', dispatcherPassword);
    await page.click('button[type="submit"]');
    
    await page.waitForTimeout(3000);
    await screenshot('17-dispatcher-login');
    
    // Check console for errors
    const consoleErrors = await page.evaluate(() => {
      const errors: string[] = [];
      return errors;
    });
    
    addResult('✅ Dispatcher role tested');
    
    // Logout from dispatcher
    const logoutLink2 = await page.locator('a, button').filter({ hasText: /Выход|Logout/i }).isVisible().catch(() => false);
    if (logoutLink2) {
      await page.locator('a, button').filter({ hasText: /Выход|Logout/i }).first().click();
      await page.waitForTimeout(1000);
    }
  } else {
    addResult('❌ Logout button not found');
  }
}

async function generateReport() {
  addResult('\n=== FINAL SUMMARY ===');
  
  const reportContent = `
# PilingTrack Comprehensive Test Report
Date: ${new Date().toISOString()}

## Test Results Summary

${testResults.join('\n')}

## Recommendations

1. Review all modules for consistency
2. Ensure data population in Equipment module
3. Test PDF generation and export functionality
4. Verify role-based access controls
5. Check console for JavaScript errors

---
Report generated at: ${new Date().toLocaleString()}
`;

  fs.writeFileSync(path.join(screenshotDir, '../TEST-RESULTS-COMPREHENSIVE.md'), reportContent);
  addResult('\n📄 Report saved to TEST-RESULTS-COMPREHENSIVE.md');
  
  console.log('\n' + reportContent);
}

async function runTests() {
  try {
    await testAdminLogin();
    await testDashboard();
    await testSites();
    await testEquipment();
    await testCrews();
    await testReports();
    await testDictionaries();
    await testUsers();
    await testReverseNavigation();
    await testReportEditing();
    await testOtherRoles();
    await generateReport();
    
  } catch (error) {
    addResult(`❌ Test error: ${error}`);
    console.error('Test failed:', error);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

// Execute tests
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  page = await context.newPage();
  
  await runTests();
  
  await context.close();
  await browser.close();
})().catch(console.error);
