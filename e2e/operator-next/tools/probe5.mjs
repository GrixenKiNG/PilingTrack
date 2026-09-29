import {chromium} from '@playwright/test';
async function scenario(label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({storageState: 'e2e/operator-next/.auth/ka.json', baseURL: 'http://localhost:3210', viewport: {width: 375, height: 812}, hasTouch: true, isMobile: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow'});
  const page = await ctx.newPage();
  await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(6000);
  const before = await page.evaluate(() => ({
    message: document.body.innerText.includes('Черновик не сохранится'),
    drafts: Object.keys(localStorage).filter((k) => k.includes('drafts')),
  }));
  await page.getByRole('button', {name: 'Записать сваи'}).first().click().catch(() => {});
  await page.getByLabel('Сколько свай забито, шт').fill('11').catch(() => {});
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    message: document.body.innerText.includes('Черновик не сохранится'),
    drafts: Object.keys(localStorage).filter((k) => k.includes('drafts')),
  }));
  console.log(label, 'до ввода:', JSON.stringify(before), 'после ввода:', JSON.stringify(after));
  await browser.close();
}
await scenario('[прогон A]');
await scenario('[прогон B]');