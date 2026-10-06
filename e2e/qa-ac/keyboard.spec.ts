/**
 * Блок G задания №5: клавиатура.
 *
 * На дашборде, в «Отчётах» и «Объектах»: Tab доходит до главных действий,
 * фокус виден, Esc закрывает окна, Enter открывает строку списка.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, matrix, must } from '../qa/helpers';
import { pause, writeRunJson } from './util';

const ADMIN = must(matrix.roles.find((r) => r.role === 'ADMIN'), 'роль ADMIN').email;
const report: Array<{ step: string; ok: boolean; note: string }> = [];

async function tabWalk(page: Page, limit = 120) {
  const names: string[] = [];
  let withVisibleFocus = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const inMain = Boolean(el.closest('main'));
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow !== 'none' && s.boxShadow !== '';
      const name = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      return { inMain, visible: outline || shadow, name };
    });
    if (!info) break;
    if (info.inMain && info.name) {
      names.push(info.name);
      if (info.visible) withVisibleFocus++;
    }
    if (names.length >= 6) break;
  }
  return { names, withVisibleFocus };
}

function record(step: string, ok: boolean, note: string) {
  report.push({ step, ok, note });
  expect.soft(ok, `${step}: ${note}`).toBe(true);
}

test('G: клавиатура — дашборд, отчёты, объекты', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  await login(page, ADMIN);

  // --- Дашборд: Tab доходит до главных действий, фокус виден.
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible({ timeout: 90_000 });
  await pause(page, 1000);
  const dash = await tabWalk(page);
  record('дашборд: Tab доходит до действий', dash.names.length >= 3, `достигнуто: ${dash.names.slice(0, 5).join(' → ')}`);
  record('дашборд: фокус виден', dash.withVisibleFocus >= 1, `элементов с видимым фокусом: ${dash.withVisibleFocus}`);

  // --- Отчёты: Esc закрывает окно.
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible({ timeout: 90_000 });
  await pause(page, 1500);
  const rep = await tabWalk(page);
  record('отчёты: Tab доходит до действий', rep.names.length >= 3, `достигнуто: ${rep.names.slice(0, 5).join(' → ')}`);
  record('отчёты: фокус виден', rep.withVisibleFocus >= 1, `элементов с видимым фокусом: ${rep.withVisibleFocus}`);
  await page.getByRole('button', { name: 'Новый отчёт' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog'), 'Esc закрыл окно отчёта').toBeHidden({ timeout: 10_000 });
  record('отчёты: Esc закрывает окно', true, 'диалог «Сформировать отчёт» закрылся');

  // --- Объекты: Esc закрывает окно; Enter открывает строку списка.
  await page.goto('/admin/sites');
  await expect(page.getByRole('heading', { name: 'Объекты' })).toBeVisible({ timeout: 90_000 });
  await pause(page, 1500);
  const sites = await tabWalk(page);
  record('объекты: Tab доходит до действий', sites.names.length >= 3, `достигнуто: ${sites.names.slice(0, 5).join(' → ')}`);
  record('объекты: фокус виден', sites.withVisibleFocus >= 1, `элементов с видимым фокусом: ${sites.withVisibleFocus}`);

  await page.getByRole('button', { name: 'Новый объект' }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog'), 'Esc закрыл окно объекта').toBeHidden({ timeout: 10_000 });
  record('объекты: Esc закрывает окно', true, 'диалог «Новый объект» закрылся');

  // Строка списка: фокус → Enter → панель показывает именно эту строку.
  const rows = page.locator('main [role="button"][tabindex="0"]');
  const count = await rows.count();
  record('объекты: строки списка доступны с клавиатуры', count >= 2, `строк с role=button: ${count}`);
  const target = rows.nth(Math.min(1, Math.max(0, count - 1)));
  const rowName = await target.evaluate((el) => (el.querySelector('span.font-medium')?.textContent ?? '').trim());
  await target.focus();
  await page.keyboard.press('Enter');
  await pause(page, 900);
  const panelTitle = await page.locator('main aside h2').first().textContent().catch(() => null);
  record('объекты: Enter открывает строку списка', Boolean(rowName) && (panelTitle ?? '').trim() === rowName,
    `строка «${rowName}», панель «${(panelTitle ?? '').trim()}»`);

  writeRunJson('keyboard.json', { generatedAt: new Date().toISOString(), report });
});
