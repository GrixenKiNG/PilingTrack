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
    const flat = await sections.count() === 0;
    if (flat ? guard > 0 : incomplete < 0) break;
    if (!flat) {
      const section = sections.nth(incomplete);
      if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
    }
    const normal = page.getByRole('button', { name: 'Норма', exact: true });
    for (let i = 0; i < await normal.count(); i++) await normal.nth(i).click();
    const measures = page.locator('input[type="number"], input[inputmode="decimal"], input[inputmode="numeric"]');
    for (let i = 0; i < await measures.count(); i++) {
      const input = measures.nth(i);
      if (await input.inputValue()) continue;
      const label = await input.evaluate(el => el.closest('label')?.innerText || el.parentElement?.innerText || '');
      const previous = label.match(/(?:Прошлое показание:|было)\s*(\d+(?:[.,]\d+)?)\s*м\/ч/i);
      if (/моточас|м\/ч/i.test(label)) {
        if (!previous) throw new Error('Known synthetic meter reading is required');
        await input.fill(String(Number(previous[1].replace(',', '.')) + 1));
      } else if (/%/.test(label)) await input.fill('50');
    }
  }
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
}

for (const version of ['v7', 'v10', 'operator', 'v5'] as const) for (const multiple of [false, true]) test(version + ': real admission, inspections, offline replay, production and closed report (' + (multiple ? 'multiple rigs' : 'single rig') + ')', async ({ page, context }, info) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const fixture = await createRoleAuditFixture();
  const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
  await db.connect();
  const equipmentName = 'Ночной цикл ' + version + ' ' + fixture.equipmentId;
  const mainScreen = version === 'operator';
  const v5Screen = version === 'v5';
  const amountLabel = mainScreen ? 'Свай, шт' : version === 'v10' ? 'Количество, шт' : 'Количество, шт.';
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
    await page.goto(mainScreen ? '/operator' : '/operator/' + version);
    await expect(page.getByRole('button', { name: /^Следующий шаг:/ })).toBeVisible();
    observed.push({ step: 'initial', state: await state(page) });
    await next(page);
    await page.getByRole('button', { name: 'Комплект в порядке', exact: true }).click();
    await expect.poll(async () => (await state(page)).identity.ppe.confirmed).toBe(true);
    await next(page);
    if (mainScreen) await page.getByRole('button', { name: 'Прочитал и ознакомлен', exact: true }).click();
    else {
      await page.getByRole('button', { name: /^Я ознакомился с инструкцией/ }).click();
      await page.getByRole('button', { name: v5Screen ? 'Подтвердить ознакомление' : 'Ознакомлен', exact: true }).click();
    }
    await expect.poll(async () => (await state(page)).identity.briefing.ok).toBe(true);
    const attempt = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operator/knowledge-attempt');
    await next(page);
    const questions = (await (await attempt).json()).data.questions as Array<{ text: string; options: string[]; correct: number }>;
    for (const question of questions) {
      await expect(page.getByText(question.text, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: question.options[question.correct], exact: true }).click();
      if (mainScreen || v5Screen) await page.getByRole('button', { name: 'Верно, дальше', exact: true }).click();
      else {
        await page.getByRole('button', { name: 'Ответить', exact: true }).click();
        await page.getByRole('button', { name: 'Далее', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: 'Записать результат', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('ADMISSION');
    await next(page);
    expect((await state(page)).options).toHaveLength(multiple ? 2 : 1);
    if (version === 'v7' || (mainScreen && multiple)) await page.getByRole('button').filter({ hasText: equipmentName }).click();
    else if (version === 'v10') {
      await expect(page.getByText(equipmentName, { exact: false }).first()).toBeVisible();
      expect((await state(page)).assignment?.equipmentId).toBe(fixture.equipmentId);
      observed.push({ step: 'v10 accepts displayed default assignment; no alternative rig selector', options: (await state(page)).options });
    }
    if (v5Screen) await page.locator('.card').filter({ hasText: equipmentName }).getByRole('button', { name: 'Принять машину', exact: true }).click();
    else await page.getByRole('button', { name: mainScreen ? 'Принять и открыть смену' : 'Принять установку', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('PRESHIFT_INSPECTION');
    for (const phase of ['PRESHIFT_INSPECTION', 'SITE_READY', 'STARTUP'] as const) {
      expect((await state(page)).phase).toBe(phase);
      await next(page);
      await checklist(page);
      await expect.poll(async () => (await state(page)).phase).not.toBe(phase);
      observed.push({ step: phase, state: await state(page) });
    }
    expect((await state(page)).phase).toBe('WORK');
    if (v5Screen) await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    if (v5Screen) {
      await next(page);
      for (const stage of ['TB_PILING', 'TB_DRILLING'] as const) {
        const list = (await state(page)).checklists.find(item => item.stage === stage);
        if (!list) throw new Error(stage + ' checklist is required');
        await page.getByRole('button').filter({ hasText: list.title }).click();
        await checklist(page);
        await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === stage)?.done).toBe(true);
      }
      await next(page);
    } else if (mainScreen) {
      await next(page);
      await page.getByRole('button', { name: 'Пройти чек-лист', exact: true }).click();
      await checklist(page);
      await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === 'TB_PILING')?.done).toBe(true);
      await next(page);
      await page.getByRole('button', { name: 'Бурение', exact: true }).click();
      await page.getByRole('button', { name: 'Пройти чек-лист', exact: true }).click();
      await checklist(page);
      await expect.poll(async () => (await state(page)).checklists.find(item => item.stage === 'TB_DRILLING')?.done).toBe(true);
      await next(page);
    } else {
    await page.getByRole("button", { name: "ТБ", exact: true }).click();
    if (version === 'v10') await page.getByRole('button', { name: /^Чек-листы ТБ по видам работ/ }).click();
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
    }
    if (version === 'v10') {
      await page.getByRole('button', { name: 'Добавить сваю', exact: true }).click();
      await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).selectOption({ label: 'QA C120.30' });
    }
    else if (v5Screen) {
      await page.getByRole('button', { name: 'Добавить сваю', exact: true }).click();
      await page.getByRole('combobox').selectOption({ label: 'QA C120.30' });
    }
    else if (mainScreen) {
      await page.getByRole('button', { name: 'Пачкой', exact: true }).click();
      await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).selectOption({ label: 'QA C120.30' });
    }
    else await page.getByRole('button', { name: 'QA C120.30', exact: true }).click();
    if (v5Screen) await page.getByRole('textbox').first().fill('2');
    else await page.getByLabel(amountLabel, { exact: true }).fill('2');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(page.getByText(/Сохранено на устройстве|В очереди: 1|запись сохранена/i).first()).toBeVisible();
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
    await page.getByRole("button", { name: mainScreen || v5Screen ? "Бурение" : "Добавить бурение", exact: true }).first().click();
    if (version === 'v10' || mainScreen) await page.getByRole('combobox', { name: 'Тип бурения', exact: true }).selectOption({ label: 'QA бурение' });
    else if (v5Screen) await page.getByRole("combobox").selectOption({ label: "QA бурение" });
    else await page.getByRole("button", { name: "QA бурение", exact: true }).click();
    if (v5Screen) {
      await page.getByRole("textbox").nth(0).fill("1");
      await page.getByRole("textbox").nth(1).fill("3");
    } else {
      await page.getByLabel(mainScreen ? "Скважин, шт" : amountLabel, { exact: true }).fill("1");
      await page.getByLabel(mainScreen ? "Метров на одну скважину" : "Метров на скважину", { exact: true }).fill("3");
    }
    await page.getByRole("button", { name: "Записать", exact: true }).click();
    await expect.poll(async () => (await state(page)).production.drilling.meters).toBe(3);
    await page.getByRole("button", { name: version === 'v10' ? "Записать простой" : "Простой", exact: true }).first().click();
    if (version === 'v10' || mainScreen) await page.getByRole('combobox', { name: 'Причина простоя', exact: true }).selectOption({ label: 'QA ожидание' });
    else if (v5Screen) await page.getByRole("combobox").selectOption({ label: "QA ожидание" });
    else await page.getByRole("button", { name: "QA ожидание", exact: true }).click();
    if (v5Screen) await page.getByRole("spinbutton").fill("0.25");
    else await page.getByLabel("Простой, часов", { exact: true }).fill("0.25");
    await page.getByRole("button", { name: "Записать", exact: true }).click();
    await expect.poll(async () => (await state(page)).production.downtimeHours).toBe(0.25);
    if (version === 'v10' || v5Screen) await page.getByRole('button', { name: '← К смене', exact: true }).click();
    if (mainScreen) await page.getByRole("button", { name: "Ещё", exact: true }).click();
    else await page.getByRole("button", { name: "Инцидент", exact: true }).click();
    if (version === 'v10') {
      await page.getByRole('button', { name: 'Записать происшествие', exact: true }).click();
      await page.getByRole('combobox', { name: 'Событие', exact: true }).selectOption('OTHER');
    } else if (v5Screen) {
      await page.getByRole("button", { name: "Записать происшествие", exact: true }).click();
      await page.getByRole("combobox").selectOption("OTHER");
    } else {
      if (mainScreen) await page.getByRole('button', { name: 'Записать происшествие', exact: true }).click();
      await page.getByRole("button", { name: /^Другое/ }).click();
    }
    await page.getByRole("button", { name: "Другой наблюдаемый признак", exact: true }).click();
    const description = "Синтетическое учебное происшествие ночной проверки, без реального оборудования и пострадавших.";
    if (v5Screen) await page.getByRole("textbox").fill(description);
    else await page.getByLabel(version === 'v10' || mainScreen ? "Как было дело" : "Опишите своими словами", { exact: true }).fill(description);
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
    await page.getByRole('button', { name: version === 'v10' || mainScreen ? 'Закрыть смену и отправить отчёт' : 'Закрыть смену', exact: true }).click();
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
    await page.screenshot({ path: info.outputPath(version + '-closed.png'), fullPage: true });
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.DISPATCHER.email, fixture.password);
    await page.goto('/admin/reports');
    await page.getByPlaceholder('Поиск по оператору, объекту, установке').fill(equipmentName);
    const reportButton = page.getByRole("button", { name: "Показать в правой панели", exact: true });
    await expect(reportButton).toHaveCount(1);
    await reportButton.click();
    await expect(page.getByRole('heading', { name: `Отчёт #${closed.receipt?.reportId}`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(version + '-dispatcher-report.png'), fullPage: true });
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
