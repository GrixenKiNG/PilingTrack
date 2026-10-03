/**
 * Обход экрана «как новичок»: каждая видимая кнопка, вкладка и ссылка
 * навигации нажимается, результат пишется в реестр покрытия.
 * Необратимые действия (DESTRUCTIVE) не нажимаются — они отмечаются
 * «NOT CHECKED», их проходит Hermes-новичок с отменой в диалоге.
 */
import type { Page } from '@playwright/test';
import { coverage, crashText, DESTRUCTIVE, shot } from './helpers';

const MAX_BUTTONS_PER_SCREEN = 40;

/** Дождаться, пока экран дорисуется: число видимых элементов перестало меняться (до 6 с — живые дашборды меняются всегда). */
export async function settle(page: Page) {
  let last = -1;
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate(() => Array.from(document.querySelectorAll('button, a[href], [role="tab"]'))
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => 0);
    if (n > 0 && n === last) return;
    last = n;
    await page.waitForTimeout(500);
  }
}

interface Ctx { role: string; version: string; module: string }

/**
 * Пометить видимые кнопки экрана атрибутом data-qa-idx и вернуть их подписи.
 * Нажатие идёт по метке, а не по имени: видимый текст («Все объекты ›»)
 * расходится с доступным именем, и поиск по имени промахивался.
 */
async function markButtons(page: Page): Promise<{ items: { idx: number; name: string }[]; unnamed: number }> {
  return page.evaluate(() => {
    const items: { idx: number; name: string }[] = [];
    let unnamed = 0;
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], [role="tab"], [role="switch"], [role="checkbox"]'));
    els.forEach((el, i) => {
      el.removeAttribute('data-qa-idx');
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || (el as HTMLButtonElement).disabled) return;
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) { unnamed++; return; }
      el.setAttribute('data-qa-idx', String(i));
      items.push({ idx: i, name });
    });
    return { items, unnamed };
  });
}

/** Всплывающие уведомления исчезают сами — их кнопки не проверяем. */
const SKIP = /^close toast$/i;

/** Нажать все кнопки текущего экрана, возвращаясь на него после каждой. */
export async function crawlScreen(page: Page, ctx: Ctx, screen: string, errs: { take(): string[] }) {
  await settle(page);
  errs.take();
  const home = page.url();
  const first = await markButtons(page);
  const names = first.items.map((x) => x.name).filter((n) => !SKIP.test(n));
  if (first.unnamed > 0) {
    coverage({ ...ctx, screen, element: `${first.unnamed} кнопок без подписи`, result: 'DEFECT',
      evidence: `у кнопок нет текста/aria-label — новичок не поймёт назначение; ${await shot(page, `${ctx.role}-${ctx.version}-${screen}-unnamed`)}` });
  }
  const seen = new Map<string, number>();
  for (const name of names.slice(0, MAX_BUTTONS_PER_SCREEN)) {
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    if (DESTRUCTIVE.test(name)) {
      coverage({ ...ctx, screen, element: name, result: 'NOT CHECKED', evidence: 'необратимое действие — проходит Hermes с отменой' });
      continue;
    }
    try {
      // Оставшееся открытым окно перекрывает экран: закрыть, а не выдать за дефект.
      if (await page.locator('[role="dialog"], [role="alertdialog"]').first().isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => undefined);
        if (await page.locator('[role="dialog"], [role="alertdialog"]').first().isVisible().catch(() => false)) {
          await page.goto(home).catch(() => undefined);
          await settle(page);
        }
      }
      let now = await markButtons(page);
      let hit = now.items.filter((x) => x.name === name)[nth];
      if (!hit) {
        // Предыдущая кнопка переключила вкладку — ищем на свежем экране.
        await page.goto(home).catch(() => undefined);
        await settle(page);
        now = await markButtons(page);
        hit = now.items.filter((x) => x.name === name)[nth];
      }
      if (!hit) {
        coverage({ ...ctx, screen, element: name, result: 'NOT CHECKED', evidence: 'кнопка пропала с экрана после предыдущих нажатий' });
        continue;
      }
      await page.locator(`[data-qa-idx="${hit.idx}"]`).click({ timeout: 5_000 });
      await settle(page);
      const crash = await crashText(page);
      const problems = errs.take();
      if (crash || problems.length) {
        coverage({ ...ctx, screen, element: name, result: 'DEFECT',
          evidence: `${crash ?? ''} ${problems.join(' | ')} ${await shot(page, `${ctx.role}-${ctx.version}-${screen}-${name}`)}`.trim() });
      } else {
        coverage({ ...ctx, screen, element: name, result: 'OK', evidence: page.url().replace('http://localhost:3000', '') });
      }
    } catch (e) {
      coverage({ ...ctx, screen, element: name, result: 'BLOCKED', evidence: `не нажимается: ${(e as Error).message.split('\n')[0]} ${await shot(page, `${ctx.role}-${ctx.version}-${screen}-${name}-blocked`)}` });
    }
    // Назад на экран: закрыть диалог, вернуть адрес.
    await page.keyboard.press('Escape').catch(() => undefined);
    if (page.url() !== home) { await page.goto(home).catch(() => undefined); await settle(page); }
  }
  if (names.length > MAX_BUTTONS_PER_SCREEN) {
    coverage({ ...ctx, screen, element: `ещё ${names.length - MAX_BUTTONS_PER_SCREEN} кнопок`, result: 'NOT CHECKED', evidence: 'лимит обхода на экран' });
  }
}

/** Ссылки навигации текущего экрана (меню, вкладки-ссылки) — только свои адреса. */
export async function navLinks(page: Page): Promise<{ name: string; href: string }[]> {
  await settle(page);
  return page.evaluate(() => {
    const out = new Map<string, string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//') || /login|logout|api\//.test(href)) continue;
      const r = a.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = (a.getAttribute('aria-label') || a.innerText || a.getAttribute('title') || href).trim().replace(/\s+/g, ' ');
      if (!out.has(href)) out.set(href, name.slice(0, 80));
    }
    return [...out].map(([href, name]) => ({ href, name }));
  });
}
