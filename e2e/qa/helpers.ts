/**
 * Общее для ежедневного QA: матрица, вход, реестр покрытия, отлов ошибок.
 * Матрица и пароли лежат вне репозитория (D:/PillingR/qa).
 */
import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const QA_DIR = 'D:/PillingR/qa';
const RUN_DIR = process.env.QA_RUN_DIR || path.join(QA_DIR, 'runs', 'manual');
export const OUT_DIR = path.join(RUN_DIR, 'playwright');
fs.mkdirSync(OUT_DIR, { recursive: true });

export interface OperatorVersion {
  version: string; path: string; operator: string; assistant: string; equipment: string;
}
export interface Matrix {
  operatorVersions: OperatorVersion[];
  roles: { role: string; email: string }[];
  excluded: { email: string }[];
}

export const matrix: Matrix = JSON.parse(fs.readFileSync(path.join(QA_DIR, 'matrix.json'), 'utf8'));
const credentials: Record<string, string> = JSON.parse(fs.readFileSync(path.join(QA_DIR, '.credentials.json'), 'utf8'));

const AUTH_DIR = path.join(QA_DIR, '.auth');

/**
 * Вход как обычный пользователь — через форму /login, но не чаще нужного:
 * вход ограничен 20 попытками за 15 минут на весь адрес, а пользователей в
 * матрице почти столько же. Сессия каждого сохраняется в D:/PillingR/qa/.auth
 * и переиспользуется, пока сервер её принимает.
 */
export async function login(page: Page, email: string) {
  if (matrix.excluded.some((e) => e.email === email)) throw new Error(`${email} исключён владельцем`);
  const password = credentials[email];
  if (!password) throw new Error(`нет пароля для ${email} — запустите qa-setup.mjs`);
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const stateFile = path.join(AUTH_DIR, `${email.replace(/[^a-z0-9@._-]/gi, '_')}.json`);
  const onLogin = /\/login(\?|$)/;
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    await page.context().addCookies(state.cookies ?? []);
    await page.goto('/');
    await page.waitForTimeout(1500);
    if (!onLogin.test(page.url())) return;
    await page.context().clearCookies();
  }
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).not.toHaveURL(onLogin, { timeout: 90_000 });
  await page.context().storageState({ path: stateFile });
}

/** Строка реестра покрытия: модуль;экран;элемент;роль;версия;результат;доказательство. */
export function coverage(row: {
  module: string; screen: string; element: string; role: string; version: string;
  result: 'OK' | 'DEFECT' | 'BLOCKED' | 'NOT CHECKED'; evidence: string;
}) {
  const file = path.join(OUT_DIR, 'coverage.csv');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '\uFEFFмодуль;экран;элемент;роль;версия;результат;доказательство\n');
  const cell = (s: string) => `"${String(s).replace(/"/g, '""').replace(/\s+/g, ' ').slice(0, 300)}"`;
  fs.appendFileSync(file, [row.module, row.screen, row.element, row.role, row.version, row.result, row.evidence].map(cell).join(';') + '\n');
}

/**
 * Ошибки страницы, которые пользователь не должен видеть: исключения JS,
 * ответы сервера 5xx и 4xx на собственный API (кроме 401/403/404/409/422 —
 * это штатные отказы, их оценивает сценарий).
 */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`JS: ${e.message}`));
  page.on('response', (r) => {
    const url = r.url();
    if (!url.startsWith('http://localhost:3000')) return;
    const s = r.status();
    if (s >= 500 || (s >= 400 && url.includes('/api/') && ![401, 403, 404, 409, 422].includes(s))) {
      errors.push(`HTTP ${s} ${r.request().method()} ${url.replace('http://localhost:3000', '')}`);
    }
  });
  return {
    take() { return errors.splice(0, errors.length); },
  };
}

/** Экран сломан, если видна заглушка ошибки Next/React. */
export async function crashText(page: Page): Promise<string | null> {
  const markers = ['Application error', 'Unhandled Runtime Error', 'Что-то пошло не так', 'Internal Server Error'];
  for (const m of markers) {
    if (await page.getByText(m, { exact: false }).first().isVisible().catch(() => false)) return m;
  }
  return null;
}

export async function shot(page: Page, name: string) {
  const file = path.join(OUT_DIR, 'shots', `${name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 120)}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
  return path.relative(OUT_DIR, file);
}

/** Кнопки, которые обход НЕ нажимает: необратимое, выход и отправка данных. */
export const DESTRUCTIVE = /удал|архив|сброс|выйти|выход|отозв|аннулир|подпис|опублик|отправ|закрыть смену|сдать|завершить смену|принять смену|передать|списать|заблок|деактив|delete|remove|logout|reset/i;

/**
 * Значение, которое тест уже проверил ожиданием: отсутствие — явная ошибка,
 * а не "undefined" дальше по коду (замена `!` без правил стиля).
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Нет значения: ${what}`);
  return value;
}
