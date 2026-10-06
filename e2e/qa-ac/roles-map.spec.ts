/**
 * Блок A задания №5: карта ролей.
 *
 * Для каждой роли из matrix.roles и помощника — какие пункты меню видны и какие
 * главные кнопки доступны на каждом экране. Администратор — входом и через
 * «Действую как» по всем пяти замещаемым ролям + своей.
 *
 * Результат — roles-map.json в папке прогона; из него собирается таблица
 * docs/qa-autoclaw/roles-map.md. «Подозрительное» (роль видит чужой раздел)
 * вычисляется при сборке отчёта по ожидаемому меню.
 */
import { expect, test } from '@playwright/test';
import { login, matrix } from '../qa/helpers';
import { pause, readButtons, readMenu, writeRunJson } from './util';

const roleEmail = (role: string) => matrix.roles.find((r) => r.role === role)!.email;
const ADMIN_EMAIL = roleEmail('ADMIN');
const REAL = [
  ...matrix.roles.filter((r) => r.role !== 'ADMIN'),
  // Помощник — роль со своим входом; берём помощника первой версии.
  { role: 'ASSISTANT', email: matrix.operatorVersions[0].assistant },
];
const ACTING = ['MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER', 'DISPATCHER', 'OPERATOR'] as const;

interface Row {
  actor: string;
  role: string;
  mode: string;
  landing: string;
  menu: { label: string; href: string }[];
  screens: { href: string; buttons: string[] }[];
  notes: string[];
}

const rows: Row[] = [];

async function collectScreens(page: import('@playwright/test').Page, row: Row, deep: boolean) {
  const landing = new URL(page.url()).pathname;
  row.landing = landing;
  row.menu = await readMenu(page);
  const visited = new Set<string>();
  const visit = async (href: string) => {
    if (visited.has(href)) return;
    visited.add(href);
    await page.goto(href).catch(() => undefined);
    await pause(page, 700);
    row.screens.push({ href, buttons: await readButtons(page) });
  };
  await visit(landing);
  if (deep) {
    for (const item of row.menu) await visit(item.href);
  }
}

test('A: карта ролей — меню и главные кнопки', async ({ page }) => {
  test.setTimeout(45 * 60_000);

  // 1. Реальные входы: диспетчер, механик, мастер, инженер ОТ, помощник.
  for (const acc of REAL) {
    const row: Row = { actor: `${acc.role} (вход)`, role: acc.role, mode: 'вход', landing: '', menu: [], screens: [], notes: [] };
    await login(page, acc.email);
    await collectScreens(page, row, true);
    rows.push(row);
  }

  // 2. Администратор: свой обход целиком.
  await login(page, ADMIN_EMAIL);
  const adminRow: Row = { actor: 'ADMIN (вход)', role: 'ADMIN', mode: 'вход', landing: '', menu: [], screens: [], notes: [] };
  await collectScreens(page, adminRow, true);
  rows.push(adminRow);

  // 3. Администратор в «Действую как» по пяти ролям (всего 6 с собственной).
  const sel = page.locator('select[aria-label="Роль, от имени которой вы работаете"]');
  await page.goto('/admin');
  await pause(page, 700);
  for (const role of ACTING) {
    await sel.selectOption(role);
    await page.waitForFunction(
      (v) => (document.querySelector('select[aria-label="Роль, от имени которой вы работаете"]') as HTMLSelectElement | null)?.value === v,
      role,
    );
    await pause(page, 1200);
    const row: Row = { actor: `ADMIN → действую как ${role}`, role, mode: 'действую как', landing: '', menu: [], screens: [], notes: [] };
    if (role !== 'MECHANIC') await page.goto('/admin').catch(() => undefined);
    await pause(page, 900);
    await collectScreens(page, row, false);
    rows.push(row);
  }
  // Вернуться к своей роли.
  await sel.selectOption('ADMIN');
  await page.waitForFunction(
    () => (document.querySelector('select[aria-label="Роль, от имени которой вы работаете"]') as HTMLSelectElement | null)?.value === 'ADMIN',
  );
  await pause(page, 700);
  expect(await sel.inputValue()).toBe('ADMIN');

  writeRunJson('roles-map.json', { generatedAt: new Date().toISOString(), rows });

  // Каждая строка общей оболочки должна иметь непустое меню. У помощника
  // своя оболочка-мастер без общего меню — его «действия» в screens.
  for (const row of rows) {
    if (row.role === 'ASSISTANT') continue;
    expect.soft(row.menu.length, `${row.actor}: меню пустое`).toBeGreaterThan(0);
  }
  // Помощник — не машинист: «Смена» ему в меню не положена.
  const assistant = rows.find((r) => r.role === 'ASSISTANT');
  expect.soft(assistant?.menu.some((m) => m.href === '/operator'), 'ASSISTANT: лишний пункт «/operator»').toBe(false);
});
