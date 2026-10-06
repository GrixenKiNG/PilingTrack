/**
 * Пробник DOM для починки селектора kpi-consistency.spec.ts (задание №5б).
 * Логинит QA_HERMES-администратора и снимает структуру KPI-плиток на трёх
 * экранах: /admin (дашборд), /admin/sites, /admin/reports. Ничего не пишет в
 * приложение; пароли читает из .credentials.json и не печатает.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const EMAIL = 'qa-hermes-admin@piling.test';
const AUTH = 'D:/PillingR/qa/.auth/qa-hermes-admin@piling.test.json';
const CREDS = 'D:/PillingR/qa/.credentials.json';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: fs.existsSync(AUTH) ? AUTH : undefined,
  baseURL: 'http://localhost:3000',
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});
const page = await ctx.newPage();

async function ensureAuth() {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('/login')) return;
  const creds = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const password = creds[EMAIL];
  if (!password) throw new Error('нет пароля в .credentials.json для QA_HERMES-администратора');
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /войти/i }).click();
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 90_000 });
}

const scan = () => page.evaluate(() => {
  const main = document.querySelector('main');
  const root = main ?? document.body;
  const valueHits = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const t = (el.textContent || '').replace(/[\u00A0\u202F]/g, ' ').trim();
    if (/\d[\d ]*шт\.\s*\/\s*[\d ,]+м\.п\./.test(t)) {
      valueHits.push({
        tag: el.tagName,
        cls: String(el.className ?? '').slice(0, 70),
        text: t.slice(0, 90),
        children: el.childElementCount,
        kids: Array.from(el.children).slice(0, 4).map((c) => `${c.tagName}«${(c.textContent || '').replace(/[\u00A0\u202F]/g, ' ').trim().slice(0, 40)}»`),
      });
    }
  }
  const labelHits = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const t = (el.textContent || '').trim();
    if (/^(Сваи|Бурение)( факт)?$/.test(t)) {
      labelHits.push({ tag: el.tagName, cls: String(el.className ?? '').slice(0, 60), leaves: el.childElementCount });
    }
  }
  const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => h.textContent?.trim()).filter(Boolean).slice(0, 8);
  return { inMain: !!main, headings, valueHits: valueHits.slice(0, 10), labelHits: labelHits.slice(0, 10) };
});

await ensureAuth();

await page.goto('/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
console.log('=== DASH initial ===');
console.log(JSON.stringify(await scan(), null, 2));

const periodBtn = page.getByRole('button', { name: 'Весь период', exact: true });
if (await periodBtn.count()) {
  await periodBtn.click();
  await page.waitForTimeout(6000);
  console.log('=== DASH after «Весь период» ===');
  console.log(JSON.stringify(await scan(), null, 2));
} else {
  console.log('=== кнопки периода нет; кнопки на экране: ===');
  console.log(JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('main button')).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 20)), null, 2));
}

await page.goto('/admin/sites', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('=== SITES ===');
console.log(JSON.stringify(await scan(), null, 2));

await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('=== REPORTS ===');
console.log(JSON.stringify(await scan(), null, 2));

await browser.close();
