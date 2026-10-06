import {chromium} from '@playwright/test';
const ctx = await (await chromium.launch()).newContext({
  storageState: 'e2e/operator-next/.auth/ka.json',
  baseURL: 'http://localhost:3210', viewport: {width: 375, height: 812}, hasTouch: true, isMobile: true,
  locale: 'ru-RU', timezoneId: 'Europe/Moscow', deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(6000);
console.log('URL:', page.url());
const state = await (async () => { const r = await page.request.get('/api/operator/mobile/state'); const j = await r.json(); return j.data; })();
console.log('PHASE:', state.phase);
console.log('IDENTITY:', JSON.stringify(state.identity));
console.log('OPTIONS:', state.options.length, state.options.map(o => o.equipmentName + ' / ' + o.siteName).join(' | '));
console.log('SHIFT:', state.shift ? JSON.stringify({id: state.shift.id, state: state.shift.state}) : 'нет');
console.log('CHECKLISTS:', state.checklists.map(c => `${c.stage}:${c.done}`).join(', '));
const texts = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button')).map(b => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
  return {innerText: document.body.innerText.slice(0, 1400), buttons: buttons.slice(0, 25)};
});
console.log('--- BUTTONS ---'); console.log(texts.buttons.join('\n'));
console.log('--- TEXT ---'); console.log(texts.innerText);
await page.screenshot({path: 'C:/Users/PC/.openclaw-autoclaw/workspace/.openclaw/tmp/opnext-probe1.png', fullPage: true});
await ctx.browser().close();