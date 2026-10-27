import { test, expect } from './fixtures/disposable.fixture';
import { createRoleAuditFixture } from './fixtures/role-audit.mjs';
import { login } from './page-objects/login.page';
import type { OperatorMobileState } from '../src/modules/operator-mobile';
import type { Page } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

async function state(page: Page): Promise<OperatorMobileState> {
  const response = await page.request.get('/api/operator/mobile/state');
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function next(page: Page) {
  const button = page.getByRole('button', { name: /^Следующий шаг:/ });
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await button.click();
}

async function checklist(page: Page) {
  // Use the actual section controls, including individually required answers.
  for (let guard = 0; guard < 30; guard++) {
    const sections = page.locator('button[aria-expanded]');
    let incomplete = -1;
    for (let i = 0; i < await sections.count(); i++) {
      const text = await sections.nth(i).innerText();
      const count = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (count && Number(count[1]) < Number(count[2])) { incomplete = i; break; }
    }
    if (incomplete < 0) break;
    const section = sections.nth(incomplete);
    if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
    const normal = page.getByRole('button', { name: 'Норма', exact: true });
    for (let i = 0; i < await normal.count(); i++) await normal.nth(i).click();
    const measures = page.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    for (let i = 0; i < await measures.count(); i++) {
      const input = measures.nth(i);
      if (await input.inputValue()) continue;
      const label = await input.evaluate(el => el.closest('label')?.innerText || '');
      const previous = label.match(/Прошлое показание:\s*(\d+(?:[.,]\d+)?)\s*м\/ч/i);
      if (/моточас|м\/ч/i.test(label)) {
        if (!previous) throw new Error('Known synthetic meter reading is required');
        await input.fill(String(Number(previous[1].replace(',', '.')) + 1));
      } else if (/%/.test(label)) await input.fill('50');
    }
  }
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
}

for (const multiple of [false, true]) test('v7: real admission, inspections, offline replay, production and closed report (' + (multiple ? 'multiple rigs' : 'single rig') + ')', async ({ page, context }, info) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await createRoleAuditFixture();
  const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
  await db.connect();
  const equipmentName = 'Ночной цикл v7 ' + fixture.equipmentId;
  const observed: Array<Record<string, unknown>> = [];
  const commands: Array<Record<string, unknown>> = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/operator/mobile/command') {
      const body = request.postDataJSON();
      if (body.attemptToken) body.attemptToken = "[fixture nonce redacted]";
      commands.push(body);
    }
  });
  const commandResponses: Array<Record<string, unknown>> = [];
  page.on("response", async response => {
    if (new URL(response.url()).pathname === "/api/operator/mobile/command") {
      const body = await response.json().catch(() => null);
      commandResponses.push({ status: response.status(), body });
    }
  });
  try {
    await db.query('INSERT INTO "MeterReading" (id,"tenantId","equipmentId","recordedAt","engineHours",source) VALUES ($1,$2,$3,$4,100,$5)',
      [randomUUID(), fixture.tenantId, fixture.equipmentId, new Date(Date.now() - 3_600_000), 'MANUAL']);
    await db.query('UPDATE "Equipment" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.equipmentId, fixture.tenantId, equipmentName]);
    if (multiple) {
      const extraId = randomUUID();
      await db.query('INSERT INTO "Equipment" (id,"tenantId",name,model,kind,"hammerKind","engineHoursTotal","fuelTankLiters","updatedAt") SELECT $1,"tenantId",$2,model,kind,"hammerKind",100,400,now() FROM "Equipment" WHERE id=$3 AND "tenantId"=$4', [extraId, 'Вторая учебная установка', fixture.equipmentId, fixture.tenantId]);
      await db.query('INSERT INTO "Crew" (id,name,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [randomUUID(), 'Вторая учебная бригада', fixture.users.OPERATOR.id, extraId, fixture.siteId]);
    }
    await login(page, fixture.users.OPERATOR.email, fixture.password);
    await page.goto('/operator/v7');
    await expect(page.getByRole('button', { name: /^Следующий шаг:/ })).toBeVisible();
    observed.push({ step: 'initial', state: await state(page) });
    await next(page);
    await page.getByRole('button', { name: 'Комплект в порядке', exact: true }).click();
    await expect.poll(async () => (await state(page)).identity.ppe.confirmed).toBe(true);
    await next(page);
    await page.getByRole('button', { name: /^Я ознакомился с инструкцией/ }).click();
    await page.getByRole('button', { name: 'Ознакомлен', exact: true }).click();
    await expect.poll(async () => (await state(page)).identity.briefing.ok).toBe(true);
    const attempt = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operator/knowledge-attempt');
    await next(page);
    const questions = (await (await attempt).json()).data.questions as Array<{ text: string; options: string[]; correct: number }>;
    for (const question of questions) {
      await expect(page.getByText(question.text, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: question.options[question.correct], exact: true }).click();
      await page.getByRole('button', { name: 'Ответить', exact: true }).click();
      await page.getByRole('button', { name: 'Далее', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Записать результат', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('ADMISSION');
    await next(page);
    expect((await state(page)).options).toHaveLength(multiple ? 2 : 1);
    await page.getByRole('button').filter({ hasText: equipmentName }).click();
    await page.getByRole('button', { name: 'Принять установку', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('PRESHIFT_INSPECTION');
    for (const phase of ['PRESHIFT_INSPECTION', 'SITE_READY', 'STARTUP'] as const) {
      expect((await state(page)).phase).toBe(phase);
      await next(page);
      await checklist(page);
      await expect.poll(async () => (await state(page)).phase).not.toBe(phase);
      observed.push({ step: phase, state: await state(page) });
    }
    expect((await state(page)).phase).toBe('WORK');
    await page.getByRole("button", { name: "ТБ", exact: true }).click();
    const piling = (await state(page)).checklists.find(item => item.stage === "TB_PILING");
    if (!piling) throw new Error('TB_PILING checklist is required for this cycle');
    await page.getByRole("button").filter({ hasText: piling.title }).click();
    await checklist(page);
    await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === "TB_PILING")?.done).toBe(true);
    const drilling = (await state(page)).checklists.find(item => item.stage === "TB_DRILLING");
    if (!drilling) throw new Error('TB_DRILLING checklist is required for this cycle');
    await page.getByRole("button").filter({ hasText: drilling.title }).click();
    await checklist(page);
    await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === "TB_DRILLING")?.done).toBe(true);
    await page.getByRole("button", { name: "Смена", exact: true }).click();
    await next(page);
    await page.getByRole('button', { name: 'QA C120.30', exact: true }).click();
    await page.getByLabel('Количество, шт.', { exact: true }).fill('2');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(page.getByText(/Сохранено на устройстве|В очереди: 1/).first()).toBeVisible();
    await context.setOffline(false);
    await expect.poll(async () => (await state(page)).production.piles.count, { timeout: 45_000 }).toBe(2);
    const pileCommand = commands.find(command => command.command === 'log-production');
    expect(pileCommand?.clientCommandId).toBeTruthy();
    const replay = await page.request.post('/api/operator/mobile/command', {
      headers: { Origin: new URL(page.url()).origin }, data: pileCommand,
    });
    expect(replay.status()).toBe(200);
    expect((await state(page)).production.piles.count).toBe(2);
    observed.push({ step: 'offline replay', state: await state(page), commandId: pileCommand?.clientCommandId });
    await page.getByRole("button", { name: "Добавить бурение", exact: true }).click();
    await page.getByRole("button", { name: "QA бурение", exact: true }).click();
    await page.getByLabel("Количество, шт.", { exact: true }).fill("1");
    await page.getByLabel("Метров на скважину", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Записать", exact: true }).click();
    await expect.poll(async () => (await state(page)).production.drilling.meters).toBe(3);
    await page.getByRole("button", { name: "Простой", exact: true }).click();
    await page.getByRole("button", { name: "QA ожидание", exact: true }).click();
    await page.getByLabel("Простой, часов", { exact: true }).fill("0.25");
    await page.getByRole("button", { name: "Записать", exact: true }).click();
    await expect.poll(async () => (await state(page)).production.downtimeHours).toBe(0.25);
    await page.getByRole("button", { name: "Инцидент", exact: true }).click();
    await page.getByRole("button", { name: /^Другое/ }).click();
    await page.getByRole("button", { name: "Другой наблюдаемый признак", exact: true }).click();
    await page.getByLabel("Опишите своими словами", { exact: true }).fill("Синтетическое учебное происшествие ночной проверки, без реального оборудования и пострадавших.");
    await page.getByRole("button", { name: "Записать происшествие", exact: true }).click();
    await expect.poll(async () => (await state(page)).incidents.length).toBe(1);
    observed.push({ step: "drilling, downtime and incident", state: await state(page) });
    await expect(page.getByRole('button', { name: 'Следующий шаг: Завершить работу', exact: true })).toBeVisible();
    await next(page);
    await page.getByRole('button', { name: 'Да, завершить', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('CLOSING');
    await next(page);
    await checklist(page);
    await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === 'EO_AFTER')?.done).toBe(true);
    await next(page);
    await page.getByRole('button', { name: 'Закрыть смену', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('CLOSED');
    const closed = await state(page);
    expect(closed.receipt?.reportId).toBeTruthy();
    expect(closed.receipt?.submittedAt).toBeTruthy();
    const persisted = await db.query('SELECT r.status, s.state, (SELECT sum(p.count)::int FROM "PileWork" p WHERE p."reportId"=r.id AND p."tenantId"=$1) AS piles FROM "Report" r JOIN "Shift" s ON s.id=r."shiftId" WHERE r."tenantId"=$1 AND r."shiftId"=$2', [fixture.tenantId, closed.shift?.id]);
    expect(persisted.rows).toEqual([{ status: 'submitted', state: 'CLOSED', piles: 2 }]);
    await expect.poll(async () => (await db.query('SELECT published, projected FROM "OutboxEvent" WHERE "tenantId"=$1 AND type=$2 AND "aggregateId"=$3', [fixture.tenantId, 'ReportSubmitted', closed.receipt?.reportId])).rows,
      { timeout: 20_000 }).toEqual([{ published: true, projected: true }]);
    await expect.poll(async () => (await db.query('SELECT "totalPiles", "totalDrilling", "totalDowntime" FROM "ReportAnalytics" WHERE "tenantId"=$1 AND "reportId"=$2', [fixture.tenantId, closed.receipt?.reportId])).rows,
      { timeout: 20_000 }).toEqual([{ totalPiles: 2, totalDrilling: 3, totalDowntime: 0.25 }]);
    const audit = await db.query('SELECT action, "actorId" FROM "ReportAudit" WHERE "reportId"=$1 AND action=$2', [closed.receipt?.reportId, 'submitted']);
    expect(audit.rows).toEqual([{ action: 'submitted', actorId: fixture.users.OPERATOR.id }]);
    const feed = await db.query('SELECT action FROM "FeedbackEvent" WHERE "targetId"=$1', [closed.receipt?.reportId]);
    await expect.poll(async () => Number((await db.query('SELECT count(*) AS count FROM "FeedbackEvent" WHERE "targetId"=$1 AND action=$2', [closed.receipt?.reportId, 'ReportSubmitted'])).rows[0].count), { timeout: 20_000 }).toBe(1);
    observed.push({ step: 'audit and general feed are separate', audit: audit.rows, feed: feed.rows });
    observed.push({ step: 'closed', state: closed });
    await page.screenshot({ path: info.outputPath('v7-closed.png'), fullPage: true });
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.DISPATCHER.email, fixture.password);
    await page.goto('/admin/reports');
    await page.getByPlaceholder('Поиск по оператору, объекту, установке').fill(equipmentName);
    const reportButton = page.getByRole("button", { name: "Показать в правой панели", exact: true });
    await expect(reportButton).toHaveCount(1);
    await reportButton.click();
    await expect(page.getByRole('heading', { name: `Отчёт #${closed.receipt?.reportId}`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('v7-dispatcher-report.png'), fullPage: true });
    observed.push({ step: 'dispatcher sees the actual submitted report', reportId: closed.receipt?.reportId });
  } finally {
    await context.setOffline(false);
    await db.end();
    await info.attach('operator-cycle', { body: JSON.stringify({ observed, commands, commandResponses }), contentType: 'application/json' });
  }
});

test('v3: assigned site selector remains reachable beside persistent navigation', async ({ page }, info) => {
  test.setTimeout(90_000);
  const fixture = await createRoleAuditFixture();
  await login(page, fixture.users.OPERATOR.email, fixture.password);
  await page.goto('/operator/v3');
  const site = page.getByRole('combobox');
  await expect(site).toContainText('QA полигон');
  await page.screenshot({ path: info.outputPath('v3-before-site.png'), fullPage: true });
  await site.click();
  const option = page.getByRole('option', { name: 'QA полигон', exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(site).toContainText('QA полигон');
  await page.screenshot({ path: info.outputPath('v3-site-selected.png'), fullPage: true });
});
