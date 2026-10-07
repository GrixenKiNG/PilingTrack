/**
 * W18: экран «Нет доступа к разделу» (правки W15 и W17).
 *
 * Раньше отказ в праве на раздел был молчаливым переходом на домашний экран
 * роли: человек открывал адрес из закладки или письма и оказывался в другом
 * месте без объяснения — выглядело как «страница исчезла» (W11-NO-ACCESS-SCREEN).
 * Теперь гвард раздела (`require-page-ability.ts`, W15) и родительские раскладки
 * админки (W17) и контура готовности (W22) ведут на страницу `/no-access`
 * с заголовком, пояснением и
 * кнопкой «На мой главный экран» → `roleHomeRoute(user.role)`.
 *
 * Здесь проверяется только показ отказа, данные не читаются и не пишутся.
 * Вход — по готовым сессиям из D:/PillingR/qa/.auth (пароли не читаются).
 */
import { expect, test } from '@playwright/test';
import { login, matrix, must } from '../qa/helpers';

const roleEmail = (role: string) => must(matrix.roles.find((r) => r.role === role), `роль ${role}`).email;
const ADMIN = roleEmail('ADMIN');
const DISPATCHER = roleEmail('DISPATCHER');
// Помощник смену не ведёт: его домашний экран /assistant (roleHomeRoute).
const ASSISTANT = matrix.operatorVersions[0].assistant;

const NO_ACCESS_TITLE = 'Нет доступа к разделу';
const HOME_BUTTON = 'На мой главный экран';

/** Экран отказа отрисован: адрес, заголовок и кнопка возврата на домашний экран роли. */
async function expectNoAccess(page: import('@playwright/test').Page, home: string) {
  await expect(page).toHaveURL(/\/no-access/, { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: NO_ACCESS_TITLE })).toBeVisible();
  const btn = page.getByRole('link', { name: HOME_BUTTON });
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('href', home);
}

test('N1: диспетчер без права на раздел видит «Нет доступа»', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, DISPATCHER);
  // /admin/users требует users.manage (только ADMIN); диспетчер раскладкой
  // админки допущен, поэтому отказ даёт гвард раздела (W15).
  await page.goto('/admin/users');
  // Домашний маршрут диспетчера — /admin (roleHomeRoute).
  await expectNoAccess(page, '/admin');
});

test('N2: помощник на /admin/reports видит «Нет доступа»', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, ASSISTANT);
  // ASSISTANT отсекается родительской раскладкой админки ещё до раздела (W17).
  await page.goto('/admin/reports');
  // Домашний маршрут помощника — /assistant.
  await expectNoAccess(page, '/assistant');
});

test('N2b: помощник на /admin/to видит «Нет доступа»', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, ASSISTANT);
  // ASSISTANT отсекается раскладкой контура готовности (W22): раньше молча уводило
  // на чужой /operator, теперь — объяснение отказа.
  await page.goto('/admin/to');
  // Домашний маршрут помощника — /assistant.
  await expectNoAccess(page, '/assistant');
});

test('N3: администратор на /admin/reports — отказа нет', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, ADMIN);
  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: NO_ACCESS_TITLE })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/no-access/);
});

test('N4: параметр ?from= показан текстом, ссылки по нему нет', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, DISPATCHER);
  // Заведомо несуществующий раздел: его нет ни в меню, ни в других ссылках —
  // значит любая ссылка с таким адресом была бы построена из параметра from.
  const from = '/admin/razdel-iz-parametra-xyz';
  await page.goto(`/no-access?from=${encodeURIComponent(from)}`);
  await expect(page.getByRole('heading', { name: NO_ACCESS_TITLE })).toBeVisible();
  await expect(page.getByText(`Запрошенный адрес: ${from}`)).toBeVisible();
  await expect(page.locator(`a[href="${from}"]`)).toHaveCount(0);
});
