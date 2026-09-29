import {chromium} from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: 'e2e/operator-next/.auth/ka.json',
  baseURL: 'http://localhost:3210', viewport: {width: 375, height: 812}, hasTouch: true, isMobile: true,
  locale: 'ru-RU', timezoneId: 'Europe/Moscow',
});
const page = await ctx.newPage();
await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(5000);
const test = await page.evaluate(() => {
  const out = {};
  try { localStorage.setItem('piling.onx.drafts.v1:probe', '1'); localStorage.removeItem('piling.onx.drafts.v1:probe'); out.probeOk = true; } catch (e) { out.probeOk = 'FAIL: ' + e.message; }
  try { localStorage.setItem('acqa.test', 'x'); out.setOk = localStorage.getItem('acqa.test') === 'x'; localStorage.removeItem('acqa.test'); } catch (e) { out.setOk = 'FAIL: ' + e.message; }
  out.keys = Object.keys(localStorage);
  out.message = document.body.innerText.includes('Черновик не сохранится');
  return out;
});
console.log(JSON.stringify(test, null, 2));
const drafts = await page.evaluate(() => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (k.includes('drafts')) out[k] = (localStorage.getItem(k) ?? '').length;
  }
  return out;
});
console.log('drafts keys:', JSON.stringify(drafts));
await browser.close();