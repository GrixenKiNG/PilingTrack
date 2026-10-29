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

async function checklist(page: Page, beforeFinish?: () => Promise<void>) {
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
  if (beforeFinish) await beforeFinish();
  await page.getByRole('button', { name: 'Завершить', exact: true }).click();
}


async function closingSummary(page: Page, db: Client, tenantId: string, shiftId: string, observed: Array<Record<string, unknown>>, stage: string) {
  const sql = await db.query('SELECT (SELECT coalesce(sum(p.count),0)::int FROM "PileWork" p WHERE p."tenantId"=$1 AND p."shiftId"=$2) AS piles, (SELECT coalesce(sum(p.count::numeric*g."lengthMm"/1000.0),0)::float FROM "PileWork" p JOIN "PileGrade" g ON g.id=p."pileGradeId" WHERE p."tenantId"=$1 AND p."shiftId"=$2) AS "pileMeters", (SELECT coalesce(sum(d.count),0)::int FROM "LeaderDrilling" d WHERE d."tenantId"=$1 AND d."shiftId"=$2) AS drilling, (SELECT coalesce(sum(d.meters),0)::float FROM "LeaderDrilling" d WHERE d."tenantId"=$1 AND d."shiftId"=$2) AS "drillingMeters", (SELECT coalesce(sum(d.duration),0)::float FROM "ReportDowntime" d WHERE d."tenantId"=$1 AND d."shiftId"=$2 AND d.kind IS DISTINCT FROM $3) AS downtime', [tenantId, shiftId, 'BREAK']);
  const totals = sql.rows[0];
  const card = page.locator('.ov10-card').filter({ has: page.getByText('Итог смены', { exact: true }) });
  await expect(card).toHaveCount(1);
  const number = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
  for (const [label, value] of [
    ['Сваи выполнено', totals.piles + ' шт · ' + number(totals.pileMeters) + ' м.п.'],
    ['Бурение', totals.drilling + ' скв · ' + number(totals.drillingMeters) + ' м'],
    ['Простой', String(Math.round(totals.downtime * 100) / 100).replace('.', ',') + ' ч'],
  ]) {
    await expect(card.locator('.ov10-pair').filter({ has: page.getByText(label, { exact: true }) }).locator('.v')).toHaveText(value);
  }
  await card.scrollIntoViewIfNeeded();
  const geometry = await card.evaluate(el => {
    const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const box = rect(el), nav = document.querySelector('.ov10-tabs');
    return { card: box, nav: nav ? rect(nav) : null, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      rows: Array.from(el.querySelectorAll('.ov10-pair')).map(row => ({ row: rect(row), label: rect(row.querySelector('.k')!), value: rect(row.querySelector('.v')!) })) };
  });
  observed.push({ step: 'v10 SQL summary ' + stage, shiftId, totals, viewport: page.viewportSize(), geometry });
  expect(geometry.scrollWidth, stage + ': card must not overflow horizontally').toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.nav).not.toBeNull();
  expect(geometry.card.bottom, stage + ': summary must stay above bottom navigation after scrolling').toBeLessThanOrEqual(geometry.nav!.top + 1);
  for (const row of geometry.rows) {
    expect(row.value.right).toBeLessThanOrEqual(geometry.card.right + 1);
    expect(row.value.left).toBeGreaterThanOrEqual(geometry.card.left - 1);
    const overlaps = row.label.left < row.value.right && row.label.right > row.value.left && row.label.top < row.value.bottom && row.label.bottom > row.value.top;
    expect(overlaps, stage + ': label and value must not overlap').toBe(false);
  }
  return totals;
}

async function longClosingSummary(page: Page, db: Client, tenantId: string, shiftId: string, observed: Array<Record<string, unknown>>) {
  const piles = (await db.query('SELECT id,count FROM "PileWork" WHERE "tenantId"=$1 AND "shiftId"=$2', [tenantId, shiftId])).rows;
  const drillings = (await db.query('SELECT id,count,meters FROM "LeaderDrilling" WHERE "tenantId"=$1 AND "shiftId"=$2', [tenantId, shiftId])).rows;
  expect(piles).toHaveLength(1);
  expect(drillings).toHaveLength(1);
  try {
    // Synthetic layout stress only; normal values are restored before submitting.
    await db.query('UPDATE "PileWork" SET count=1234567890 WHERE id=$1 AND "tenantId"=$2', [piles[0].id, tenantId]);
    await db.query('UPDATE "LeaderDrilling" SET count=1234567890,meters=14814814680.5 WHERE id=$1 AND "tenantId"=$2', [drillings[0].id, tenantId]);
    await page.reload();
    await next(page);
    await closingSummary(page, db, tenantId, shiftId, observed, 'long numbers');
    await page.screenshot({ path: test.info().outputPath('v10-summary-long.png'), fullPage: true });
  } finally {
    for (const row of piles) await db.query('UPDATE "PileWork" SET count=$3 WHERE id=$1 AND "tenantId"=$2', [row.id, tenantId, row.count]);
    for (const row of drillings) await db.query('UPDATE "LeaderDrilling" SET count=$3,meters=$4 WHERE id=$1 AND "tenantId"=$2', [row.id, tenantId, row.count, row.meters]);
  }
  await page.reload();
  await next(page);
}

for (const version of ['v7', 'v10', 'operator', 'v5', 'v2'] as const) for (const multiple of [false, true]) for (const width of version === 'v10' ? [375, 1440] : [375]) test(version + ': real admission, inspections, offline replay, production and closed report (' + (multiple ? 'multiple rigs' : 'single rig') + ')' + (version === 'v10' ? ' viewport ' + width : ''), async ({ page, context }, info) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width, height: width > 1000 ? 1000 : 812 });
  const fixture = await createRoleAuditFixture();
  const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
  await db.connect();
  const equipmentName = 'Ночной цикл ' + version + ' ' + fixture.equipmentId;
  const mainScreen = version === 'operator';
  const v5Screen = version === 'v5';
  const v2Screen = version === 'v2';
  const crossRole = v2Screen && !multiple && info.project.name === 'chromium';
  const operatorName = 'QA OPERATOR ' + fixture.equipmentId;
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
    if (crossRole) await db.query('UPDATE "User" SET name=$3 WHERE id=$1 AND "tenantId"=$2', [fixture.users.OPERATOR.id, fixture.tenantId, operatorName]);
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
    if (mainScreen || v2Screen) await page.getByRole('button', { name: 'Прочитал и ознакомлен', exact: true }).click();
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
      if (mainScreen || v5Screen || v2Screen) await page.getByRole('button', { name: 'Верно, дальше', exact: true }).click();
      else {
        await page.getByRole('button', { name: 'Ответить', exact: true }).click();
        await page.getByRole('button', { name: 'Далее', exact: true }).click();
      }
    }
    await page.getByRole('button', { name: 'Записать результат', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('ADMISSION');
    await next(page);
    expect((await state(page)).options).toHaveLength(multiple ? 2 : 1);
    if (version === 'v7' || v2Screen || (mainScreen && multiple)) await page.getByRole('button').filter({ hasText: equipmentName }).click();
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
    if (v5Screen || v2Screen) await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
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
    else if (v2Screen) await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).selectOption({ label: 'QA C120.30' });
    else if (v5Screen) {
      await page.getByRole('button', { name: 'Добавить сваю', exact: true }).click();
      await page.getByRole('combobox').selectOption({ label: 'QA C120.30' });
    }
    else if (mainScreen) {
      await page.getByRole('button', { name: 'Пачкой', exact: true }).click();
      await page.getByRole('combobox', { name: 'Марка сваи', exact: true }).selectOption({ label: 'QA C120.30' });
    }
    else await page.getByRole('button', { name: 'QA C120.30', exact: true }).click();
    if (v2Screen) await page.getByLabel('Количество свай', { exact: true }).fill('2');
    else if (v5Screen) await page.getByRole('textbox').first().fill('2');
    else await page.getByLabel(amountLabel, { exact: true }).fill('2');
    await context.setOffline(true);
    await page.getByRole('button', { name: v2Screen ? 'Добавить 2 шт' : 'Записать', exact: true }).click();
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
    if (version === 'v10' || mainScreen || v2Screen) await page.getByRole('combobox', { name: 'Тип бурения', exact: true }).selectOption({ label: 'QA бурение' });
    else if (v5Screen) await page.getByRole("combobox").selectOption({ label: "QA бурение" });
    else await page.getByRole("button", { name: "QA бурение", exact: true }).click();
    if (v2Screen) {
      await page.getByLabel("Количество скважин", { exact: true }).fill("1");
      await page.getByLabel("Глубина одной скважины, м", { exact: true }).fill("3");
    } else if (v5Screen) {
      await page.getByRole("textbox").nth(0).fill("1");
      await page.getByRole("textbox").nth(1).fill("3");
    } else {
      await page.getByLabel(mainScreen ? "Скважин, шт" : amountLabel, { exact: true }).fill("1");
      await page.getByLabel(mainScreen ? "Метров на одну скважину" : "Метров на скважину", { exact: true }).fill("3");
    }
    await page.getByRole("button", { name: v2Screen ? "Записать 3.0 м" : "Записать", exact: true }).click();
    await expect.poll(async () => (await state(page)).production.drilling.meters).toBe(3);
    await page.getByRole("button", { name: version === 'v10' ? "Записать простой" : "Простой", exact: true }).first().click();
    if (v2Screen) await page.getByRole('combobox', { name: 'Причина', exact: true }).selectOption({ label: 'QA ожидание' });
    else if (version === 'v10' || mainScreen) await page.getByRole('combobox', { name: 'Причина простоя', exact: true }).selectOption({ label: 'QA ожидание' });
    else if (v5Screen) await page.getByRole("combobox").selectOption({ label: "QA ожидание" });
    else await page.getByRole("button", { name: "QA ожидание", exact: true }).click();
    if (v5Screen) await page.getByRole("spinbutton").fill("0.25");
    else await page.getByLabel("Простой, часов", { exact: true }).fill("0.25");
    await page.getByRole("button", { name: v2Screen ? "Записать простой" : "Записать", exact: true }).click();
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
      if (mainScreen || v2Screen) await page.getByRole('button', { name: 'Записать происшествие', exact: true }).click();
      await page.getByRole("button", { name: /^Другое/ }).click();
    }
    await page.getByRole("button", { name: "Другой наблюдаемый признак", exact: true }).click();
    const description = "Синтетическое учебное происшествие ночной проверки, без реального оборудования и пострадавших.";
    if (v5Screen) await page.getByRole("textbox").fill(description);
    else await page.getByLabel(version === 'v10' || mainScreen || v2Screen ? "Как было дело" : "Опишите своими словами", { exact: true }).fill(description);
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
    if (version === 'v10') {
      const current = await state(page);
      expect(current.shift?.id).toBeTruthy();
      const totals = await closingSummary(page, db, fixture.tenantId, current.shift!.id, observed, 'before close');
      expect(totals).toEqual({ piles: 2, pileMeters: 24, drilling: 1, drillingMeters: 3, downtime: 0.25 });
      await page.screenshot({ path: info.outputPath('v10-summary-before.png'), fullPage: true });
      await longClosingSummary(page, db, fixture.tenantId, current.shift!.id, observed);
      await closingSummary(page, db, fixture.tenantId, current.shift!.id, observed, 'restored before close');
    }
    await page.getByRole('button', { name: version === 'v10' || mainScreen || v2Screen ? 'Закрыть смену и отправить отчёт' : 'Закрыть смену', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('CLOSED');
    const closed = await state(page);
    if (version === 'v10') {
      await closingSummary(page, db, fixture.tenantId, closed.shift!.id, observed, 'after close');
      const receipt = page.locator('.ov10-card').filter({ has: page.getByText('Квитанция', { exact: true }) });
      await expect(receipt).toContainText(closed.receipt!.reportId);
      await expect(receipt.getByText('Отправлен', { exact: true })).toBeVisible();
    }
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
    if (crossRole) {
      const fleet = page.waitForResponse(r => new URL(r.url()).pathname === '/api/monitoring/fleet');
      await page.goto('/monitoring');
      const fleetResponse = await fleet;
      expect(fleetResponse.status()).toBe(200);
      const fleetBody = await fleetResponse.json();
      expect(fleetBody.equipment.find((r: { id: string }) => r.id === fixture.equipmentId)?.todayTotals).toEqual({ piles: 2, pileMeters: 24, drillingCount: 1, drillingMeters: 3, downtimeHours: 0.25 });
      await expect(page.locator('a[href="/admin/equipment/' + fixture.equipmentId + '"]')).toContainText(equipmentName);
      await page.screenshot({ path: info.outputPath('dispatcher-monitoring.png'), fullPage: true });
      const analytics = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/analytics/overview');
      await page.goto('/admin/analytics');
      const analyticsResponse = await analytics;
      expect(analyticsResponse.status()).toBe(200);
      const analyticsBody = await analyticsResponse.json();
      expect(analyticsBody.operators.find((r: { userId: string }) => r.userId === fixture.users.OPERATOR.id)).toMatchObject({ piles: 2, meters: 24, drilling: 3, drillingCount: 1, reports: 1 });
      const analyticsRow = page.getByRole('row').filter({ hasText: operatorName });
      await expect(analyticsRow).toHaveCount(1);
      await expect(analyticsRow.getByRole('cell').nth(2)).toHaveText('2 шт. / 24 м.п.');
      await page.screenshot({ path: info.outputPath('dispatcher-analytics.png'), fullPage: true });
      observed.push({ step: 'dispatcher monitoring and analytics show this exact operator report', equipmentId: fixture.equipmentId, operatorId: fixture.users.OPERATOR.id });
      const incident = closed.incidents[0];
      expect(incident?.id).toBeTruthy();
      expect(Number((await db.query('SELECT count(*) AS count FROM "OutboxEvent" WHERE "tenantId"=$1 AND "aggregateId"=$2 AND type=$3', [fixture.tenantId, incident.id, 'NotificationDeliveryRequested'])).rows[0].count)).toBeGreaterThan(0);
      await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
      await login(page, fixture.users.SAFETY_ENGINEER.email, fixture.password);
      await page.goto('/admin/to?view=incidents');
      const row = page.locator('li').filter({ hasText: equipmentName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(description);
      await row.getByRole('button', { name: 'Разобрать', exact: true }).click();
      const note = 'Синтетический разбор: проверили учебную запись, реальные работы не выполнялись.';
      await row.getByLabel('К чему пришли и что меняем', { exact: true }).fill(note);
      const reviewed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/incidents' && r.request().method() === 'POST');
      await row.getByRole('button', { name: 'Записать разбор', exact: true }).click();
      expect((await reviewed).status()).toBe(200);
      expect((await db.query('SELECT "reviewedById","reviewNote",("reviewedAt" IS NOT NULL) AS reviewed FROM "SafetyIncident" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, incident.id])).rows).toEqual([{reviewedById:fixture.users.SAFETY_ENGINEER.id,reviewNote:note,reviewed:true}]);
      expect((await db.query('SELECT "actorId" FROM "FeedbackEvent" WHERE "targetId"=$1 AND action=$2', [incident.id,'incident.reviewed'])).rows).toEqual([{actorId:fixture.users.SAFETY_ENGINEER.id}]);
      await page.getByRole('group', { name: 'Что показывать', exact: true }).getByRole('button', { name: 'Все', exact: true }).click();
      await expect(page.locator('li').filter({ hasText: equipmentName })).toContainText(note);
      await page.screenshot({ path: info.outputPath('incident-reviewed-by-safety.png'), fullPage: true });
      observed.push({ step: 'real safety engineer reviewed operator incident; notification outbox exists; external delivery unverified', incidentId: incident.id });
    }

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

test('cross-role: operator inspection defect, mechanic repair, acceptance and readiness recalculation', async ({ page }, info) => {
  test.setTimeout(300_000);
  const fixture = await createRoleAuditFixture();
  const db = new Client({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER });
  await db.connect();
  const observed: Array<Record<string, unknown>> = [];
  const defectTitle = 'Крюковая обойма: замок исправен';
  const work = 'Синтетическая проверка ремонта: реальная машина не ремонтировалась.';
  try {
    await db.query('INSERT INTO "MeterReading" (id,"tenantId","equipmentId","recordedAt","engineHours",source) VALUES ($1,$2,$3,$4,100,$5)', [randomUUID(), fixture.tenantId, fixture.equipmentId, new Date(Date.now() - 3_600_000), 'MANUAL']);
    await login(page, fixture.users.OPERATOR.email, fixture.password);
    await page.goto('/operator/v2');
    await next(page);
    await page.getByRole('button', { name: 'Комплект в порядке', exact: true }).click();
    await expect.poll(async () => (await state(page)).identity.ppe.confirmed).toBe(true);
    await next(page);
    await page.getByRole('button', { name: 'Прочитал и ознакомлен', exact: true }).click();
    await expect.poll(async () => (await state(page)).identity.briefing.ok).toBe(true);
    const attempt = page.waitForResponse(r => new URL(r.url()).pathname === '/api/operator/knowledge-attempt');
    await next(page);
    const questions = (await (await attempt).json()).data.questions as Array<{ text: string; options: string[]; correct: number }>;
    for (const question of questions) {
      await expect(page.getByText(question.text, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: question.options[question.correct], exact: true }).click();
      await page.getByRole('button', { name: 'Верно, дальше', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Записать результат', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('ADMISSION');
    await next(page);
    await page.getByRole('button').filter({ hasText: 'QA КБУРГ' }).click();
    await page.getByRole('button', { name: 'Принять установку', exact: true }).click();
    await expect.poll(async () => (await state(page)).phase).toBe('PRESHIFT_INSPECTION');
    await next(page);
    await checklist(page, async () => {
      const section = page.locator('button[aria-expanded]').filter({ hasText: 'Лебёдки' });
      if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
      const item = page.locator('div.rounded-lg.border.bg-card.p-3').filter({ has: page.getByText(defectTitle, { exact: true }) });
      await expect(item).toHaveCount(1);
      await item.getByRole('button', { name: 'Отказ', exact: true }).click();
      await item.getByLabel('Что именно не так', { exact: true }).fill('Учебный отказ замка, реальных повреждений нет.');
    });
    await expect.poll(async () => (await state(page)).phase).toBe('SITE_READY');
    const shiftId = (await state(page)).shift?.id;
    const defect = (await db.query('SELECT id,severity,status,"maintenanceRecordId","reportedById" FROM "EquipmentDefect" WHERE "tenantId"=$1 AND "shiftId"=$2 AND "sourceKey"=$3', [fixture.tenantId, shiftId, fixture.equipmentId + ':PRESHIFT_INSPECTION:hook'])).rows[0];
    expect(defect).toMatchObject({ severity: 'HIGH', status: 'OPEN', reportedById: fixture.users.OPERATOR.id });
    expect(defect.maintenanceRecordId).toBeTruthy();
    const orderId = defect.maintenanceRecordId;
    expect((await db.query('SELECT type,status FROM "MaintenanceRecord" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, orderId])).rows).toEqual([{ type: 'REPAIR', status: 'PLANNED' }]);
    const execution = (await db.query('SELECT id FROM "OperatorChecklistExecution" WHERE "tenantId"=$1 AND "shiftId"=$2 AND status=$3', [fixture.tenantId, shiftId, 'COMPLETED'])).rows;
    expect(execution).toHaveLength(1);
    const executionId = execution[0].id;
    const snapshot = async (triggerId: string) => (await db.query('SELECT id,"triggerType",facts,evidence,verdict FROM "ReadinessScoreSnapshot" WHERE "tenantId"=$1 AND "equipmentId"=$2 AND "triggerId"=$3', [fixture.tenantId, fixture.equipmentId, triggerId])).rows[0];
    await expect.poll(async () => (await snapshot(executionId))?.facts?.inspectionCompleted, { timeout: 30_000 }).toBe(true);
    const before = await snapshot(executionId);
    expect(before.triggerType).toBe('OPERATOR_CHECKLIST_COMPLETED');
    expect(before.facts.healthScore).toBeLessThan(100);
    expect(before.facts.findings).toBeGreaterThan(0);
    expect(before.evidence).toMatchObject({ inspectionSource: 'OPERATOR_CHECKLIST', inspectionId: executionId });
    expect(before.evidence.maintenanceRecordIds).toContain(orderId);
    observed.push({ step: 'operator defect automatically linked to repair and readiness snapshot', defect, before });
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.MECHANIC.email, fixture.password);
    const journalUrl = '/admin/to?view=maintenance&equipmentId=' + fixture.equipmentId;
    await page.goto(journalUrl);
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Журнал дефектов', exact: true }) });
    const card = panel.locator('article').filter({ hasText: defectTitle });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: 'Взять в работу', exact: true }).click();
    const triage = page.getByRole('dialog', { name: 'Взять в работу', exact: true });
    await triage.locator('select').selectOption(orderId);
    const triaged = page.waitForResponse(r => new URL(r.url()).pathname === '/api/readiness/defects/' + defect.id + '/triage' && r.request().method() === 'POST');
    await triage.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    expect((await triaged).status()).toBe(200);
    expect((await db.query('SELECT status,"triagedById" FROM "EquipmentDefect" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, defect.id])).rows).toEqual([{ status: 'IN_WORK', triagedById: fixture.users.MECHANIC.id }]);
    await page.goto('/admin/maintenance/' + orderId);
    const assignee = page.getByRole('combobox', { name: 'Исполнитель', exact: true });
    await assignee.click();
    await page.getByRole('option', { name: 'QA MECHANIC', exact: true }).click();
    await expect(assignee).toBeFocused();
    await page.getByLabel('Стадия 2 — выполненные работы', { exact: true }).fill(work);
    for (const button of ['Сохранить', 'В работе', 'Выполнено']) {
      const updated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/equipment/' + fixture.equipmentId + '/maintenance/' + orderId && r.request().method() === 'PUT');
      await page.getByRole('button', { name: button, exact: true }).click();
      expect((await updated).status()).toBe(200);
    }
    expect((await db.query('SELECT status,"workDone","closedById" FROM "MaintenanceRecord" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, orderId])).rows).toEqual([{ status: 'DONE', workDone: work, closedById: fixture.users.MECHANIC.id }]);
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.ADMIN.email, fixture.password);
    await page.goto('/admin/maintenance/' + orderId);
    const accepted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/maintenance/' + orderId + '/accept' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    expect((await accepted).status()).toBe(200);
    expect((await db.query('SELECT "acceptedById" FROM "MaintenanceRecord" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, orderId])).rows).toEqual([{ acceptedById: fixture.users.ADMIN.id }]);
    expect((await db.query('SELECT status FROM "EquipmentDefect" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, defect.id])).rows).toEqual([{ status: 'IN_WORK' }]);
    await page.request.post('/api/auth/logout', { headers: { Origin: new URL(page.url()).origin } });
    await login(page, fixture.users.MECHANIC.email, fixture.password);
    await page.goto(journalUrl);
    await card.getByRole('button', { name: 'Закрыть после ТО', exact: true }).click();
    const resolve = page.getByRole('dialog', { name: 'Отметить устранённым', exact: true });
    await resolve.getByRole('textbox', { name: /^Что сделано/ }).fill(work);
    const resolved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/readiness/defects/' + defect.id + '/resolve' && r.request().method() === 'POST');
    await resolve.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    expect((await resolved).status()).toBe(200);
    expect((await db.query('SELECT status,version,"resolvedById",resolution FROM "EquipmentDefect" WHERE "tenantId"=$1 AND id=$2', [fixture.tenantId, defect.id])).rows).toEqual([{ status: 'CLOSED', version: 3, resolvedById: fixture.users.MECHANIC.id, resolution: work }]);
    expect((await db.query('SELECT action,"entityVersion","actorId" FROM "AuditLog" WHERE "tenantId"=$1 AND "entityId"=$2 ORDER BY "entityVersion"', [fixture.tenantId, defect.id])).rows).toEqual([{ action: 'defect.triage', entityVersion: 2, actorId: fixture.users.MECHANIC.id }, { action: 'defect.resolve', entityVersion: 3, actorId: fixture.users.MECHANIC.id }]);
    await expect.poll(async () => (await snapshot(defect.id + ':v3:resolve'))?.triggerType, { timeout: 30_000 }).toBe('DEFECT_CHANGED');
    const after = await snapshot(defect.id + ':v3:resolve');
    expect(after.id).not.toBe(before.id);
    expect(after.evidence).toMatchObject({ inspectionSource: 'OPERATOR_CHECKLIST', inspectionId: executionId });
    expect(after.evidence.maintenanceRecordIds).not.toContain(orderId);
    // Repair closes the current defect; the historical inspection answer remains immutable.
    expect(after.facts.healthScore).toBe(before.facts.healthScore);
    observed.push({ step: 'mechanic completed repair, admin accepted, mechanic resolved defect; readiness recalculated', orderId, after });
    await panel.getByRole('button', { name: 'Показать закрытые', exact: true }).click();
    await expect(card).toContainText(work);
    await page.screenshot({ path: info.outputPath('defect-repair-readiness.png'), fullPage: true });
  } finally {
    await db.end();
    await info.attach('defect-repair-readiness', { body: JSON.stringify(observed), contentType: 'application/json' });
  }
});
