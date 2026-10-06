import { chromium } from '@playwright/test';
const state = 'D:/PillingR/qa/.auth/qa-hermes-admin@piling.test.json';
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: state, baseURL: 'http://localhost:3000' });
const page = await ctx.newPage();
await page.goto('/admin/reports');
await page.waitForTimeout(5000);
const before = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('div.grid.gap-3.px-3.py-3'));
  return { count: rows.length, first: rows.slice(0, 6).map((r) => (r.innerText || '').replace(/\n/g, ' | ').slice(0, 90)), hasAcqa: document.body.innerText.includes('AC-QA') };
});
await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('div.grid.gap-3.px-3.py-3'));
  return { count: rows.length, first: rows.slice(0, 6).map((r) => (r.innerText || '').replace(/\n/g, ' | ').slice(0, 90)), hasAcqa: document.body.innerText.includes('AC-QA'), filterButtons: Array.from(document.querySelectorAll('button')).map((b) => b.innerText.trim()).filter((t) => ['Все','Сегодня','Вчера','7 дней'].includes(t)) };
});
console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
