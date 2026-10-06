/**
 * Зонд экрана оператора: вход (с кэшем сессии), дамп видимых элементов и
 * текста, снимок. Задание №12. Запуск:
 *   node e2e/qa-ac/tools/probe-operator.mjs <email> <path> [outName]
 */
import {chromium} from '@playwright/test';
import fs from 'node:fs';

const [email, pathArg, outName] = process.argv.slice(2);
if (!email) { console.error('нужен email'); process.exit(1); }
const stateFile = `D:/PillingR/qa/.auth/${email.replace(/[^a-z0-9@._-]/gi, '_')}.json`;
const credentials = JSON.parse(fs.readFileSync('D:/PillingR/qa/.credentials.json', 'utf8'));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  baseURL: 'http://localhost:3000',
  viewport: {width: 430, height: 920},
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});
const page = await ctx.newPage();

// вход по кэшу или формой
if (fs.existsSync(stateFile)) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  await ctx.addCookies(state.cookies ?? []);
}
await page.goto('/operator', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(2000);
if (/\/login/.test(page.url())) {
  await page.context().clearCookies();
  await page.goto('/login', {waitUntil: 'domcontentloaded'});
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(credentials[email]);
  await page.getByRole('button', {name: 'Войти'}).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), {timeout: 90_000});
  await ctx.storageState({path: stateFile});
  console.log('login: OK (сессия обновлена)');
} else {
  console.log('login: из кэша');
}

await page.goto(pathArg || '/operator', {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove()));

const dump = await page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const items = [];
  for (const el of Array.from(document.querySelectorAll('button, a, h1, h2, h3, [role="button"], input, select, textarea, [role="status"], [role="alert"]'))) {
    if (!vis(el)) continue;
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!t && el.tagName !== 'INPUT') continue;
    items.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(/\s+/).slice(0, 3).join('.') : ''} «${t}»${el.disabled ? ' [disabled]' : ''}`);
  }
  return {url: location.href, title: document.title, body: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 2600), items: [...new Set(items)].slice(0, 140)};
});
console.log(JSON.stringify(dump, null, 1));
const out = `C:/Users/PC/.openclaw-autoclaw/workspace/.openclaw/tmp/qa12/${outName || email.split('@')[0]}.png`;
await page.screenshot({path: out, fullPage: false});
console.log('shot:', out);
await browser.close();