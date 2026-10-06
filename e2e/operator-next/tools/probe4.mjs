import {chromium} from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({storageState: 'e2e/operator-next/.auth/ka.json', baseURL: 'http://localhost:3210', viewport: {width: 375, height: 812}, hasTouch: true, isMobile: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow'});
const page = await ctx.newPage();
await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(5000);
const info = await page.evaluate(() => {
  const out = {keys: Object.keys(localStorage), message: document.body.innerText.includes('Черновик не сохранится')};
  const persist = localStorage.getItem('piling-track-storage');
  if (persist) {
    try {
      const parsed = JSON.parse(persist);
      const cu = parsed?.state?.currentUser ?? null;
      out.persistUser = cu ? {hasId: Boolean(cu.id), idLen: String(cu.id ?? '').length, role: cu.role} : null;
    } catch (e) { out.persistParse = String(e); }
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
// Открыть паспорт, напечатать, подождать сохранение, посмотреть ключи
await page.getByRole('button', {name: 'Сваи с паспортом'}).first().click().catch((e) => console.log('клик паспорта:', e.message.slice(0,80)));
await page.waitForTimeout(1500);
const input = page.getByPlaceholder('С-130');
if (await input.count()) { await input.fill('AC-QA-probe'); await page.waitForTimeout(1500); }
const after = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('drafts')));
console.log('drafts keys после ввода:', JSON.stringify(after));
const msg2 = await page.evaluate(() => document.body.innerText.includes('Черновик не сохранится'));
console.log('сообщение о черновике видно:', msg2);
await browser.close();