/**
 * Блок H задания №5: заголовки безопасности.
 *
 * Для /, /login, /admin, /api/health — фактические Content-Security-Policy,
 * X-Frame-Options, Permissions-Policy, Referrer-Policy, Strict-Transport-Security.
 * Дев-сервер: часть заголовков на бою ставит Caddy — здесь проверяемо только это.
 */
import { expect, test } from '@playwright/test';
import { login, matrix } from '../qa/helpers';
import { writeRunJson, expectDefined } from './util';

const ADMIN = expectDefined(matrix.roles.find((r) => r.role === 'ADMIN'), 'ADMIN role not found in matrix').email;
const HDRS = [
  'content-security-policy',
  'x-frame-options',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
] as const;

test('H: заголовки безопасности — /, /login, /admin, /api/health', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const out: Record<string, { status: number; headers: Record<string, string> }> = {};

  const probe = async (label: string, url: string) => {
    const res = await page.request.get(url);
    const all = res.headers();
    const headers: Record<string, string> = {};
    for (const h of HDRS) headers[h] = all[h] ?? '(не задан)';
    out[label] = { status: res.status(), headers };
  };

  // Анонимно.
  await probe('/', '/');
  await probe('/login', '/login');
  await probe('/admin (анонимно)', '/admin');
  await probe('/api/health', '/api/health');

  // Под сессией администратора.
  await login(page, ADMIN);
  await probe('/admin (админ)', '/admin');
  await probe('/api/health (админ)', '/api/health');

  writeRunJson('security-headers.json', { generatedAt: new Date().toISOString(), out });

  expect(out['/api/health'].status, 'сервис жив').toBe(200);
  expect(out['/login'].status, 'страница входа отвечает').toBe(200);
});
