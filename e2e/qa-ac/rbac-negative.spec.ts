/**
 * Блок B задания №5: негативные права через API и IDOR операторов.
 *
 * Для каждой не-админской роли — запросы к действиям, которых у неё нет:
 * ожидается 401/403, а не 200. Правки и удаления — только над записями
 * «AC-QA», созданными самим тестом, либо над заведомо несуществующими
 * идентификаторами: даже дыра в правах не должна тронуть настоящие данные.
 *
 * IDOR: оператор А читает и меняет отчёт оператора Б (оба — из matrix
 * operatorVersions). Кэш P-02: «Действую как → Оператор» и сразу обратно —
 * /api/reports/all не отдаёт ответ чужой роли в пределах 10 с кэша.
 */
import { expect, test, type Page } from '@playwright/test';
import { login, matrix } from '../qa/helpers';
import { RUN_SUF, api, sweepAcqa, writeRunJson, expectDefined } from './util';

const roleEmail = (role: string) => expectDefined(matrix.roles.find((r) => r.role === role), `role ${role} not found in matrix`).email;
const ADMIN = roleEmail('ADMIN');
const DISPATCHER = roleEmail('DISPATCHER');
const MECHANIC = roleEmail('MECHANIC');
const FOREMAN = roleEmail('FOREMAN');
const SAFETY = roleEmail('SAFETY_ENGINEER');
const ASSISTANT = matrix.operatorVersions[0].assistant;
const OP_A = matrix.operatorVersions[0].operator;
const OP_B = matrix.operatorVersions[1].operator;

/** Дата в Москве: сервер живёт по ней, UTC-полночь давала бы вчера. */
const todayMsk = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

const evidence: Array<{ role: string; check: string; status: number; ok: boolean }> = [];

async function expectDenied(label: string, role: string, res: { status(): number; text(): Promise<string> }) {
  const status = res.status();
  const ok = status === 401 || status === 403;
  if (!ok) {
    const body = await res.text().catch(() => '');
    evidence.push({ role, check: label, status, ok });
    expect
      .soft(ok, `${role}: «${label}» — ожидался отказ 401/403, получен ${status}. Ответ: ${body.slice(0, 160)}`)
      .toBe(true);
  } else {
    evidence.push({ role, check: label, status, ok });
  }
}

test('B1: негативные права ролей и IDOR операторов', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  let siteId = '';
  let reportId = '';
  let userBId = '';

  try {
    // ===== Подготовка: AC-QA объект и AC-QA отчёт оператора Б (создаёт админ) =====
    await login(page, ADMIN);
    const siteResp = await api(page).post('/api/sites/create', { data: { name: `AC-QA Объект ${RUN_SUF} (права)` } });
    expect(siteResp.status(), 'объект AC-QA создан').toBe(201);
    siteId = (await siteResp.json()).site.id as string;

    const usersResp = await api(page).get('/api/users');
    expect(usersResp.status(), 'админ видит список работников').toBe(200);
    const users = (await usersResp.json()).users as Array<{ id: string; email: string }>;
    userBId = users.find((u) => u.email === OP_B)?.id ?? '';
    expect(userBId, `пользователь ${OP_B} найден`).toBeTruthy();
    // Владелец отчёта должен быть закреплён за объектом (иначе запись отчёта — 403).
    const assignB = await api(page).post(`/api/sites/${siteId}/assign`, { data: { userId: userBId } });
    expect(assignB.status(), 'оператор Б закреплён за AC-QA объектом').toBe(200);

    const dict = await (await api(page).get('/api/dictionary/all')).json() as Record<string, unknown>;
    const grades = (dict.pileGrades ?? dict.pileGrade ?? (dict.data as Record<string, unknown> | undefined)?.pileGrades ?? []) as Array<{ id: string; isActive?: boolean }>;
    const grade = grades.find((g) => g.isActive !== false) ?? grades[0];
    expect(grade, 'активная марка сваи найдена').toBeTruthy();
    const gradeId = expectDefined(grade, 'grade missing after check').id;

    reportId = crypto.randomUUID();
    const mkReport = await api(page).post('/api/reports/admin-upsert', { data: {
      reportId, userId: userBId, siteId, date: todayMsk(),
      piles: [{ pileGradeId: gradeId, count: 1 }],
    } });
    expect(mkReport.status(), 'AC-QA отчёт оператора Б создан').toBe(200);

    // ===== IDOR: оператор А с чужим отчётом =====
    await login(page, OP_A);
    await expectDenied('PDF чужого отчёта', 'OPERATOR-A', await api(page).get(`/api/reports/single-pdf?reportId=${reportId}`));
    await expectDenied('правка чужого отчёта', 'OPERATOR-A', await api(page).post('/api/reports/upsert', { data: {
      reportId, siteId, userId: userBId, date: todayMsk(), piles: [{ pileGradeId: gradeId, count: 2 }],
    } }));
    await expectDenied('список чужого оператора', 'OPERATOR-A', await api(page).get(`/api/reports/my?userId=${userBId}`));

    // ===== Негативы по ролям =====
    const junkEmail = `ac-qa-deny-${RUN_SUF}@piling.test`;
    const cases: Array<{ role: string; email: string; checks: () => Array<[string, Promise<{ status(): number; text(): Promise<string> }>]> }> = [
      { role: 'OPERATOR-A', email: OP_A, checks: () => [
        ['ревизия отчётов', api(page).get('/api/reports/all')],
        ['все объекты', api(page).get('/api/sites/all')],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
      ] },
      { role: 'DISPATCHER', email: DISPATCHER, checks: () => [
        ['создание пользователя', api(page).post('/api/users', { data: { name: 'AC-QA Запрет', email: junkEmail, role: 'ASSISTANT' } })],
        ['справочник: смена статуса', api(page).patch('/api/dictionary/manage', { data: { type: 'pileGrade', id: 'ac-qa-no-such', isActive: false } })],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
        ['создание установки', api(page).post('/api/equipment', { data: { name: `AC-QA Установка ${RUN_SUF}` } })],
      ] },
      { role: 'MECHANIC', email: MECHANIC, checks: () => [
        ['создание пользователя', api(page).post('/api/users', { data: { name: 'AC-QA Запрет', email: junkEmail, role: 'ASSISTANT' } })],
        ['создание объекта', api(page).post('/api/sites/create', { data: { name: `AC-QA Отказ ${RUN_SUF}` } })],
        ['удаление чужого отчёта', api(page).delete('/api/reports/delete', { data: { reportId } })],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
      ] },
      { role: 'FOREMAN', email: FOREMAN, checks: () => [
        ['создание объекта', api(page).post('/api/sites/create', { data: { name: `AC-QA Отказ ${RUN_SUF}` } })],
        ['создание пользователя', api(page).post('/api/users', { data: { name: 'AC-QA Запрет', email: junkEmail, role: 'ASSISTANT' } })],
        ['создание бригады', api(page).post('/api/crews', { data: { name: `AC-QA Бригада ${RUN_SUF}` } })],
        ['справочник: смена статуса', api(page).patch('/api/dictionary/manage', { data: { type: 'pileGrade', id: 'ac-qa-no-such', isActive: false } })],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
      ] },
      { role: 'SAFETY_ENGINEER', email: SAFETY, checks: () => [
        ['создание объекта', api(page).post('/api/sites/create', { data: { name: `AC-QA Отказ ${RUN_SUF}` } })],
        ['создание пользователя', api(page).post('/api/users', { data: { name: 'AC-QA Запрет', email: junkEmail, role: 'ASSISTANT' } })],
        ['создание бригады', api(page).post('/api/crews', { data: { name: `AC-QA Бригада ${RUN_SUF}` } })],
        ['справочник: смена статуса', api(page).patch('/api/dictionary/manage', { data: { type: 'pileGrade', id: 'ac-qa-no-such', isActive: false } })],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
      ] },
      { role: 'ASSISTANT', email: ASSISTANT, checks: () => [
        ['ревизия отчётов', api(page).get('/api/reports/all')],
        ['все объекты', api(page).get('/api/sites/all')],
        ['создание пользователя', api(page).post('/api/users', { data: { name: 'AC-QA Запрет', email: junkEmail, role: 'ASSISTANT' } })],
        ['выгрузка отчётов', api(page).get(`/api/reports/export?dateFrom=${todayMsk()}&dateTo=${todayMsk()}`)],
      ] },
    ];
    for (const c of cases) {
      await login(page, c.email);
      for (const [label, promise] of c.checks()) {
        const res = await promise;
        await expectDenied(label, c.role, res);
      }
    }
  } finally {
    // ===== Уборка: отчёт, объект и возможные «протёкшие» записи =====
    await cleanup(page, reportId, siteId);
    writeRunJson('rbac-negative.json', { generatedAt: new Date().toISOString(), evidence });
  }
});

async function cleanup(page: Page, reportId: string, siteId: string) {
  try { await login(page, ADMIN); } catch { /* сессия уже есть */ }
  if (reportId) await api(page).delete('/api/reports/delete', { data: { reportId } }).catch(() => undefined);
  const sites = await (await api(page).get('/api/sites/all')).json().then((j) => j.sites as Array<{ id: string; name: string }>).catch(() => []);
  for (const s of sites.filter((s) => s.name.includes(RUN_SUF) || s.id === siteId)) {
    const del = await api(page).delete(`/api/sites/${s.id}`);
    if (del.status() >= 400) await api(page).put(`/api/sites/${s.id}`, { data: { isActive: false } }).catch(() => undefined);
  }
  const users = await (await api(page).get('/api/users')).json().then((j) => j.users as Array<{ id: string; email: string }>).catch(() => []);
  for (const u of users.filter((u) => u.email.includes(`ac-qa-deny-${RUN_SUF}`))) {
    await api(page).delete('/api/users', { data: { id: u.id } }).catch(() => undefined);
  }
  await sweepAcqa(page);
}

test('B2: кэш «Действую как» не отдаёт ответ чужой роли (P-02)', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, ADMIN);
  await page.goto('/admin');
  await page.waitForTimeout(900);
  const sel = page.locator('select[aria-label="Роль, от имени которой вы работаете"]');
  await expect(sel).toBeVisible();

  const r1 = await api(page).get('/api/reports/all?limit=5');
  expect(r1.status(), 'админ получает свои данные').toBe(200);
  const j1 = await r1.json() as { total: number; reports: unknown[] };
  expect(Array.isArray(j1.reports)).toBe(true);

  // «Действую как → Оператор»: тот же запрос с заголовком замещения — отказ.
  await sel.selectOption('OPERATOR');
  await page.waitForFunction(() => (document.querySelector('select[aria-label="Роль, от имени которой вы работаете"]') as HTMLSelectElement | null)?.value === 'OPERATOR');
  await page.waitForTimeout(800);
  const r2 = await api(page).get('/api/reports/all?limit=5', { headers: { 'x-acting-as': 'OPERATOR' } });
  expect([401, 403], 'оператору ревизия отчётов закрыта').toContain(r2.status());

  // Сразу обратно — в пределах 10 с кэша ответ чужой роли не должен достаться админу.
  await sel.selectOption('ADMIN');
  await page.waitForFunction(() => (document.querySelector('select[aria-label="Роль, от имени которой вы работаете"]') as HTMLSelectElement | null)?.value === 'ADMIN');
  await page.waitForTimeout(500);
  const r3 = await api(page).get('/api/reports/all?limit=5');
  expect(r3.status(), 'админ снова получает свои данные, а не кэш роли оператора').toBe(200);
  const j3 = await r3.json() as { total: number; reports: unknown[] };
  expect(j3.total).toBe(j1.total);
  expect(Array.isArray(j3.reports)).toBe(true);
});
