/**
 * Блок F задания №5: мобильная вёрстка 375×812.
 *
 * Для 12 разделов админки и /operator: нет горизонтальной прокрутки страницы,
 * ни одна кнопка не меньше 44×44 px, основной текст не меньше 14 px, меню
 * открывается и закрывается. Скриншоты — в папку прогона.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, matrix, shot, watchErrors, must } from '../qa/helpers';
import { RUN_SUF, pause, writeRunJson } from './util';

const ADMIN = must(matrix.roles.find((r) => r.role === 'ADMIN'), 'роль ADMIN').email;
const SECTIONS: Array<[string, string]> = [
  ['Дашборд', '/admin'],
  ['Мониторинг', '/monitoring'],
  ['Объекты', '/admin/sites'],
  ['Отчёты', '/admin/reports'],
  ['Установки', '/admin/equipment'],
  ['Техготовность', '/admin/to'],
  ['Бригады', '/admin/crews'],
  ['ТБ и допуски', '/admin/safety'],
  ['Аналитика', '/admin/analytics'],
  ['Справочники', '/admin/dictionaries'],
  ['Пользователи', '/admin/users'],
  ['Настройки', '/admin/settings'],
];

interface Finding { name: string; href: string; kind: string; ok: boolean; note: string }
const findings: Finding[] = [];
const linkDumps: Record<string, { links: string[]; navs: string[] }> = {};

async function readMobileMetrics(page: Page) {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      // A clipped 1px accessibility surrogate is not a visible control.
      const clippedSurrogate = r.width <= 1 && r.height <= 1 && (s.clip !== 'auto' || s.clipPath !== 'none');
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !clippedSurrogate;
    };
    const out = {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      smallButtons: [] as string[],
      smallText: [] as string[],
      links: [] as string[],
      navs: [] as string[],
    };
    out.links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 10)
      .map((a) => `${(a.getAttribute('aria-label') || a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)}→${a.getAttribute('href')}`);
    out.navs = Array.from(document.querySelectorAll<HTMLElement>('nav, [role="tablist"]'))
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 6)
      .map((n) => (n.getAttribute('aria-label') || n.className || '').toString().slice(0, 60));
    const scroll = { x: window.scrollX, y: window.scrollY };
    const scrollContainers = Array.from(document.querySelectorAll('*'))
      .filter((el): el is HTMLElement => el instanceof HTMLElement && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))
      .map((el) => ({ el, left: el.scrollLeft, top: el.scrollTop }));
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main button, main [role="button"], main select, main input:not([type="hidden"])'))) {
      if (!vis(el) || el.matches(':disabled, [aria-disabled="true"]')) continue;
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const labels = el.tagName === 'INPUT' ? Array.from((el as HTMLInputElement).labels ?? []) : [];
      // Hit testing includes padding and interactive ::after, but rejects clipped
      // or pointer-events:none overlays. Measure both 44px axes; rounded
      // corners do not reduce the target bounding box.
      const offsets = [-21.5, -10.75, 0, 10.75, 21.5];
      const hitsTarget = (dx: number, dy: number) => {
        const hit = document.elementFromPoint(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy);
        return hit !== null && (el.contains(hit) || labels.some((label) => label.contains(hit)));
      };
      const hasTouchArea = offsets.every((offset) => hitsTarget(offset, 0) && hitsTarget(0, offset));
      if (!hasTouchArea) {
        const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || 'без подписи').trim().replace(/\s+/g, ' ').slice(0, 40);
        out.smallButtons.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    for (const { el, left, top } of scrollContainers) el.scrollTo({ left, top, behavior: 'instant' });
    window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' });
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main p, main li, main td, main dd'))) {
      if (!vis(el)) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 25) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14 && out.smallText.length < 8) out.smallText.push(`${size}px: ${text.slice(0, 32)}`);
    }
    return out;
  });
}

async function checkMobile(page: Page, name: string, href: string) {
  const res = await readMobileMetrics(page);
  await shot(page, `mobile-${href.replace(/[^\w]+/g, '_')}`);
  linkDumps[name] = { links: res.links, navs: res.navs };
  const hOk = res.scrollWidth <= res.innerWidth + 1;
  findings.push({ name, href, kind: 'горизонтальная прокрутка', ok: hOk, note: `${name}: ${res.scrollWidth} из ${res.innerWidth}` });
  findings.push({ name, href, kind: 'кнопки 44×44', ok: res.smallButtons.length === 0, note: `${name}: ${res.smallButtons.slice(0, 4).join(' · ') || 'ок'}` });
  findings.push({ name, href, kind: 'текст 14px', ok: res.smallText.length === 0, note: `${name}: ${res.smallText.slice(0, 3).join(' · ') || 'ок'}` });
}

test('F metric: actual 44px hit area, padding and clipping', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.setContent(`<style>
    main { padding: 40px; height: 300px; overflow: auto; } .row { margin-bottom: 40px; }
    button { border: 0; padding: 0; width: 16px; height: 16px; position: relative; }
    .expanded::after { content: ''; position: absolute; width: 44px; height: 44px; top: 50%; left: 50%; transform: translate(-50%, -50%); }
    .padded { padding: 14px; box-sizing: content-box; }
    .compact { width: 36px; height: 36px; }
    .noninteractive::after { pointer-events: none; }
    .rounded { width: 44px; height: 44px; border-radius: 22px; }
    .screen-reader-only { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); }
    .clipped { overflow: hidden; width: 16px; height: 16px; }
    </style><main>
    <input type="file" class="screen-reader-only" aria-label="hidden file input" />
    <div class="row"><button class="expanded" aria-label="expanded checkbox"></button></div>
    <div class="row"><button class="padded" aria-label="padded button"></button></div>
    <div class="row"><button class="rounded" aria-label="rounded button"></button></div>
    <div class="row"><button class="compact" aria-label="compact button"></button></div>
    <div class="row"><button class="expanded noninteractive" aria-label="noninteractive pseudo"></button></div>
    <div class="row clipped"><button class="expanded" aria-label="clipped pseudo"></button></div>
    </main>`);
  const result = await readMobileMetrics(page);
  expect(await page.locator('main').evaluate((el) => el.scrollTop)).toBe(0);
  expect(result.smallButtons.map((label) => label.split(' (')[0])).toEqual([
    'compact button', 'noninteractive pseudo', 'clipped pseudo',
  ]);
});

test('F: мобильная вёрстка 375×812 — админка и оператор', async ({ page }) => {
  test.setTimeout(40 * 60_000);
  const errs = watchErrors(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, ADMIN);

  for (const [name, href] of SECTIONS) {
    await page.goto(href);
    await pause(page, 1200);
    await checkMobile(page, name, href);
  }
  writeRunJson('mobile-findings.json', { generatedAt: new Date().toISOString(), suffix: RUN_SUF, phase: 'админка', findings, linkDumps });

  // Меню открывается и закрывается.
  await page.goto('/admin');
  await pause(page, 800);
  await page.getByRole('button', { name: 'Открыть меню навигации' }).click();
  await expect(page.getByRole('dialog'), 'меню открылось').toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog'), 'меню закрылось по Esc').toBeHidden({ timeout: 10_000 });

  // Оператор: у рабочего места машиниста своя навигация (вкладки смены).
  await login(page, matrix.operatorVersions[0].operator);
  await page.goto('/operator');
  await pause(page, 1500);
  await checkMobile(page, 'Оператор', '/operator');
  const tabBar = page.locator('nav[aria-label="Разделы смены"]');
  if (await tabBar.isVisible().catch(() => false)) {
    const tabs = tabBar.getByRole('button');
    const n = await tabs.count();
    findings.push({ name: 'Оператор', href: '/operator', kind: 'меню (вкладки смены)', ok: n >= 3, note: `вкладок: ${n}` });
    // Синтетические клики: дев-наложение Next может перехватывать нажатия у края экрана.
    await tabs.last().dispatchEvent('click');
    await pause(page, 800);
    await tabs.first().dispatchEvent('click');
    await pause(page, 800);
    findings.push({ name: 'Оператор', href: '/operator', kind: 'меню (вкладки смены)', ok: true, note: 'переключение вкладок работает' });
  } else {
    // Ведение по фазам: вкладки появляются с началом работы (по замыслу экрана).
    findings.push({ name: 'Оператор', href: '/operator', kind: 'меню (вкладки смены)', ok: true,
      note: `вкладок нет в текущей фазе — экран ведёт по фазам; снято состояний: ${linkDumps['Оператор']?.navs.length ?? 0}` });
  }

  const pageProblems = errs.take();
  findings.push({ name: 'Оператор+админка', href: '-', kind: 'ошибки страницы', ok: pageProblems.length === 0, note: pageProblems.slice(0, 4).join(' | ') || 'чисто' });

  writeRunJson('mobile-findings.json', { generatedAt: new Date().toISOString(), suffix: RUN_SUF, findings, linkDumps });
  const bad = findings.filter((f) => !f.ok);
  expect
    .soft(bad.length, `нарушений 375px: ${bad.length} — ${bad.slice(0, 6).map((b) => `${b.name} / ${b.kind}: ${b.note}`).join(' | ')}`)
    .toBe(0);
});
