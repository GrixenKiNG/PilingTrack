/**
 * Вход для прогона №9: один раз на пользователя — дальше спека живёт на
 * сохранённом storageState (лимит входов: 20 попыток / 15 минут на весь ПК).
 *
 * Пароли читаются из D:/PillingR/qa/.credentials.json и НИКОГДА не печатаются.
 * Запуск:  node e2e/operator-next/tools/login.mjs ka@piling.ru
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const email = process.argv[2];
if (!email) {
  console.error('Укажите email: node e2e/operator-next/tools/login.mjs <email>');
  process.exit(1);
}
const creds = JSON.parse(fs.readFileSync('D:/PillingR/qa/.credentials.json', 'utf8'));
const password = creds[email];
if (!password) {
  console.error('Нет пароля для', email, 'в .credentials.json');
  process.exit(1);
}

const base = process.env.OPNEXT_BASE_URL ?? 'http://localhost:3210';
const outDir = path.resolve('e2e/operator-next/.auth');
fs.mkdirSync(outDir, {recursive: true});
const outFile = path.join(outDir, `${email.split('@')[0]}.json`);

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: base,
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
  viewport: {width: 375, height: 812},
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto('/');
const emailField = page.locator('#email');
await emailField.waitFor({state: 'visible', timeout: 30_000});

let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
  await emailField.fill(email);
  await page.locator('#password').fill(password);
  const respPromise = page
    .waitForResponse((r) => r.url().includes('/api/auth/login'), {timeout: 10_000})
    .catch(() => null);
  await page.locator('button[type="submit"]').click();
  const resp = await respPromise;
  if (resp && resp.ok()) {
    ok = true;
    break;
  }
  if (resp && !resp.ok()) {
    // Сервер ответил отказом — повторять бессмысленно (и вредно: лимит входов).
    console.error('вход отклонён сервером, статус', resp.status());
    await browser.close();
    process.exit(1);
  }
  // resp === null: нативное «догидрационное» отправление — POST не ушёл,
  // попытка не потрачена, просто повторяем.
  await page.waitForTimeout(1500);
}
if (!ok) {
  console.error('вход не удался: /api/auth/login не ответил успехом');
  await browser.close();
  process.exit(1);
}

await page.waitForURL((u) => !u.pathname.includes('login'), {timeout: 30_000});
await context.storageState({path: outFile});
console.log('OK: storageState сохранён в', path.relative(process.cwd(), outFile));
await browser.close();
