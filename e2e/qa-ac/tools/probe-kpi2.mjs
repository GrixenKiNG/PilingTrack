/**
 * Диагностика kpiTiles: запускает ТОЧНУЮ копию функции из util.ts и печатает,
 * что именно не сходится (near-miss элементы с кодами символов).
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
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(creds[EMAIL]);
  await page.getByRole('button', { name: /войти/i }).click();
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 90_000 });
}

// ТОЧНАЯ копия kpiTiles из e2e/qa-ac/util.ts + диагностика
const exactKpiTiles = () => page.evaluate(() => {
  const LABEL = /^(Сваи|Бурение)( факт)?$/;
  const VALUE = /^(\d[\d\s\u00A0]*)\s*шт\.\s*\/\s*([\d\s\u00A0]+(?:,\d+)?)\s*м\.п\.$/;
  const out = {};
  const diag = [];
  let valueCandidate = 0;
  for (const el of Array.from(document.querySelectorAll('main *'))) {
    const t = (el.textContent || '').trim();
    if (!VALUE.test(t)) {
      if (el.childElementCount === 0 && t.includes('шт.') && t.includes('м.п.')) {
        diag.push({ text: t.slice(0, 80), len: t.length, codes: Array.from(t).map((c) => c.charCodeAt(0)).slice(0, 40) });
      }
      continue;
    }
    valueCandidate++;
    let root = el;
    let label = '';
    for (let i = 0; i < 8 && root; i++) {
      root = root.parentElement;
      if (!root) break;
      for (const cand of Array.from(root.querySelectorAll('*'))) {
        if (cand === el) continue;
        const ct = (cand.textContent || '').trim();
        if (LABEL.test(ct) && cand.childElementCount === 0) { label = ct; break; }
      }
      if (label) break;
    }
    if (label && !(label in out)) out[label] = t;
  }
  return { valueCandidate, out, diag: diag.slice(0, 4), mainCount: document.querySelectorAll('main').length };
});

await ensureAuth();

await page.goto('/admin', { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Дашборд' }).waitFor({ timeout: 90_000 });
await page.getByRole('button', { name: 'Весь период', exact: true }).click();
await page.waitForTimeout(2000);
for (const wait of [0, 6000, 6000, 6000]) {
  if (wait) await page.waitForTimeout(wait);
  console.log('=== DASH kpiTiles attempt ===');
  console.log(JSON.stringify(await exactKpiTiles(), null, 2));
}

await page.goto('/admin/sites', { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Объекты' }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(4000);
console.log('=== SITES kpiTiles ===');
console.log(JSON.stringify(await exactKpiTiles(), null, 2));

await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Отчёты' }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(4000);
console.log('=== REPORTS kpiTiles ===');
console.log(JSON.stringify(await exactKpiTiles(), null, 2));

await browser.close();
