/**
 * Зонд №7 (задание №10): черновик паспорта сваи — сохранение в localStorage и
 * восстановление после перезагрузки страницы. Только чтение плюс пробный ввод
 * «AC-QA-probe7» в форму черновика. Запуск:
 *   node e2e/operator-next/tools/probe7.mjs [.auth/ivv.json]
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs';

const auth = process.argv[2] ?? '.auth/ivv.json';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: `D:/PillingR/wt-autoclaw/e2e/operator-next/${auth}`,
  baseURL: 'http://localhost:3210',
  viewport: {width: 375, height: 812},
  hasTouch: true, isMobile: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
});
const page = await ctx.newPage();
await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(4000);

const st = (await (await page.request.get('/api/operator/mobile/state')).json()).data;
console.log('фаза:', st.phase, '| смена:', st.shift?.id, st.shift?.state);

const dump = () => page.evaluate(() => {
  const out = {draftKeys: [], draftContents: {}, storeUser: null};
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('piling.onx.drafts.v1')) {
      out.draftKeys.push(k.replace('piling.onx.drafts.v1:', '…:'));
      const v = localStorage.getItem(k) ?? '';
      try {
        const parsed = JSON.parse(v);
        out.draftContents[k.replace('piling.onx.drafts.v1:', '…:')] = {
          workMode: parsed?.work?.mode ?? null,
          passportNumber: parsed?.passport?.number ?? null,
          passportSets: Array.isArray(parsed?.passport?.sets) ? parsed.passport.sets.length : null,
          bytes: v.length,
        };
      } catch { out.draftContents[k.slice(-30)] = v.slice(0, 80); }
    }
    if (k === 'piling-track-storage') {
      try { out.storeUser = JSON.parse(localStorage.getItem(k))?.state?.currentUser?.id ?? null; } catch { out.storeUser = '(не разобран)'; }
    }
  }
  return out;
});

console.log('== хранилище ДО ввода:', JSON.stringify(await dump()));
const passBtn = page.getByRole('button', {name: 'Сваи с паспортом'});
console.log('кнопка «Сваи с паспортом» видна:', await passBtn.first().isVisible().catch(() => false));
if ((await passBtn.count()) > 0) {
  await passBtn.first().click();
  await page.waitForTimeout(900);
}
const ph = page.getByPlaceholder('С-130');
console.log('форма паспорта видна:', await ph.isVisible().catch(() => false));
if (await ph.isVisible().catch(() => false)) {
  await ph.fill('AC-QA-probe7');
  await page.waitForTimeout(1200);
}
console.log('== хранилище ПОСЛЕ ввода:', JSON.stringify(await dump()));

await page.reload({waitUntil: 'domcontentloaded'});
await page.waitForTimeout(3500);
const vis = await ph.isVisible().catch(() => false);
const val = await ph.inputValue().catch(() => '(нет поля)');
console.log('== ПОСЛЕ перезагрузки: форма видна:', vis, '| значение:', JSON.stringify(val));
console.log('== хранилище ПОСЛЕ перезагрузки:', JSON.stringify(await dump()));

await browser.close();