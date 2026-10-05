/**
 * Прогон №10 (после правок Ж1–Ж3): повторный живой прогон /operator/next на
 * СВЕЖЕЙ смене — проверка правок и повторный замер текста в рамке 375×812.
 *
 * Что дополнительно к прогону №9:
 *  • Ж1а: кнопка быстрого простоя обрезается до начала смены («Простой с
 *    начала смены, N мин»), и запись уходит не раньше начала смены;
 *  • Ж1б: на отказ 400 «раньше смены» экран показывает ДЕТАЛЬ сервера;
 *  • Ж2: до открытия смены и на работе нет ложного «Черновик не сохранится»;
 *  • Ж3: повторный замер подписей/текста по тем же шагам (checks в отчёте).
 *
 * ПРАВИЛА ПРОГОНА: вход однажды (tools/login.mjs) → storageState .auth/ka.json;
 * все тексты — с «AC-QA »; сверки с сервером только чтением (SELECT через
 * docker exec); шаг, который невозможен, помечается и не блокирует остальные.
 * Скриншоты и итоги — в docs/operator-next/browser/ (файлы walk10-*).
 */
import {test, expect, type Page} from '@playwright/test';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.OPNEXT_BASE_URL ?? 'http://localhost:3210';
const AUTH = path.resolve(__dirname, process.env.OPNEXT_AUTH ?? '.auth/ka.json');
const OUT = path.resolve(__dirname, '../../docs/operator-next/browser');
const QA = 'AC-QA';

type StepResult = {step: string; status: 'OK' | 'ДЕФЕКТ' | 'ЗАБЛОКИРОВАНО'; evidence: string};
const results: StepResult[] = [];
const consoleErrors: string[] = [];
const checksAll: Record<string, unknown>[] = [];
const dbChecks: string[] = [];

function db(sql: string): string {
  return execSync(
    'docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -At',
    {input: sql, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true},
  ).trim();
}

async function stateOf(page: Page): Promise<Record<string, any>> {
  const response = await page.request.get('/api/operator/mobile/state');
  expect(response.status(), 'сессия должна быть жива (обновите .auth через tools/login.mjs)').toBe(200);
  return (await response.json()).data;
}

async function wherePhase(page: Page, phase: string, timeout = 120_000): Promise<void> {
  await expect.poll(async () => (await stateOf(page)).phase, {timeout, intervals: [800, 1500, 2500]}).toBe(phase);
}

/** Скриншот + механическая проверка кадра: размеры, шрифты, прокрутка. */
async function screenEvidence(page: Page, step: string, shot: string): Promise<void> {
  fs.mkdirSync(OUT, {recursive: true});
  await page.screenshot({path: path.join(OUT, shot), fullPage: true});
  const found = await page.evaluate(() => {
    const desc = (el: Element): string => {
      const he = el as HTMLElement;
      const cls = String(he.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const text = (he.getAttribute('aria-label') ?? he.getAttribute('placeholder') ?? he.textContent ?? '')
        .replace(/\s+/g, ' ').trim().slice(0, 34);
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} «${text}»`;
    };
    const visible = (el: Element): boolean => {
      const st = getComputedStyle(el as HTMLElement);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const controls: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.onx button, .onx input, .onx select, .onx textarea'))) {
      if (!visible(el)) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 44 || r.height < 44) controls.push(`${desc(el)} — ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const captions: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.onx label > span'))) {
      if (!visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el as HTMLElement).fontSize);
      if (fs < 16) captions.push(`${desc(el)} — ${fs}px`);
    }
    const texts: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.onx p, .onx li, .onx h1, .onx h2'))) {
      const he = el as HTMLElement;
      if (!visible(he) || he.childElementCount > 0) continue;
      const t = (he.textContent ?? '').trim();
      if (t.length < 2) continue;
      const fs = parseFloat(getComputedStyle(he).fontSize);
      if (fs < 16) texts.push(`${desc(el)} — ${fs}px`);
    }
    const vw = document.documentElement.clientWidth;
    return {
      controls: [...new Set(controls)],
      captions: [...new Set(captions)],
      texts: [...new Set(texts)].slice(0, 60),
      scrollX: document.documentElement.scrollWidth > vw,
    };
  });
  checksAll.push({step, shot, ...found});
}

async function step(page: Page, name: string, fn: () => Promise<void>, evidence = ''): Promise<boolean> {
  try {
    await fn();
    results.push({step: name, status: 'OK', evidence});
    return true;
  } catch (error) {
    const msg = String((error as Error)?.message ?? error).replace(/\s+/g, ' ').slice(0, 180);
    const failShot = `fail-${name.replace(/[^а-яА-Яa-zA-Z0-9-]+/g, '_').slice(0, 42)}.png`;
    try {
      fs.mkdirSync(OUT, {recursive: true});
      await page.screenshot({path: path.join(OUT, failShot), fullPage: true});
    } catch { /* снимок не критичен */ }
    results.push({step: name, status: 'ДЕФЕКТ', evidence: `падение: ${msg} (снимок ${failShot})`});
    return false;
  }
}

/** Осмотр: «весь раздел — норма», затем оставшиеся пункты, затем отправка. */
async function completeChecklist(page: Page): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const bulk = page.getByRole('button', {name: 'Весь раздел — норма'});
    if ((await bulk.count()) === 0) break;
    await bulk.first().click();
    await page.waitForTimeout(150);
  }
  const rows = page.locator('[data-testid^="inspection-item-"]');
  const total = await rows.count();
  for (let i = 0; i < total; i++) {
    const row = rows.nth(i);
    const normal = row.getByRole('button', {name: 'Норма'});
    if ((await normal.count()) === 0) continue;
    if ((await normal.getAttribute('aria-pressed')) === 'true') continue;
    const measure = row.locator('input[type="number"]');
    if ((await measure.count()) > 0) {
      const label = ((await measure.first().getAttribute('aria-label')) ?? '').toLowerCase();
      await measure.first().fill(/м\/ч|моточас|наработ/.test(label) ? '9999.9' : '50');
    }
    await normal.click();
    await page.waitForTimeout(120);
  }
  await expect(page.getByTestId('inspection-counter')).toContainText('Осмотр отмечен', {timeout: 15_000});
  await page.getByRole('button', {name: 'Завершить осмотр'}).click();
  await page.waitForTimeout(1500);
}

/** Паспорт сваи: открыть форму (если надо), выбрать марку, заполнить три залога. */
async function fillPassport(page: Page, qa: string): Promise<void> {
  const alreadyOpen = await page.getByPlaceholder('С-130').isVisible().catch(() => false);
  if (!alreadyOpen) {
    const back = page.locator('button:visible', {hasText: 'Назад к смене'});
    if ((await back.count()) > 0) {
      await back.first().click();
      await page.waitForTimeout(600);
    }
    await page.getByRole('button', {name: 'Сваи с паспортом'}).first().click();
  }
  await page.getByPlaceholder('С-130').waitFor({timeout: 20_000});
  await page.getByLabel('Марка сваи').selectOption({index: 1});
  await page.getByPlaceholder('С-130').fill(`${qa}-101`);
  const addSet = page.getByRole('button', {name: '+ Добавить залог'});
  for (let guard = 0; guard < 5 && (await page.getByLabel('Ударов').count()) < 3; guard++) {
    await addSet.click();
    await page.waitForTimeout(150);
  }
  const blows = page.getByLabel('Ударов');
  const penetration = page.getByLabel('Погружение, мм');
  await blows.nth(0).fill('30'); await penetration.nth(0).fill('12');
  await blows.nth(1).fill('32'); await penetration.nth(1).fill('9');
  await blows.nth(2).fill('34'); await penetration.nth(2).fill('7');
  await page.waitForTimeout(600);
}

/** Если открыта какая-то форма смены — вернуться к списку. */
async function ensureList(page: Page): Promise<void> {
  const back = page.locator('button:visible', {hasText: 'Назад к смене'});
  if ((await back.count()) > 0) {
    await back.first().click();
    await page.waitForTimeout(600);
  }
}

/** Сколько раз на экране видно предупреждение о недоступном черновике (Ж2). */
async function countDraftWarning(page: Page): Promise<number> {
  return page.locator('text=Черновик не сохранится').count();
}

test('повторный цикл по правкам №10 на /operator/next (375×812)', async ({browser}) => {
  test.setTimeout(16 * 60_000);
  const context = await browser.newContext({
    storageState: AUTH,
    baseURL: BASE,
    viewport: {width: 375, height: 812},
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text().replace(/\s+/g, ' ').slice(0, 300);
    if (msg.type() !== 'error') return;
    // Обрывы сети во время намеренного оффлайн-шага — ожидаемый артефакт
    // эмуляции, а не ошибка экрана.
    if (/ERR_INTERNET_DISCONNECTED|net::ERR_/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`.slice(0, 300)));
  const netErrors: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/operator/mobile/') && response.status() >= 400) {
      void response.text().then((body) => {
        netErrors.push(`${response.status()} ${url.replace(BASE, '')} :: ${body.replace(/\s+/g, ' ').slice(0, 220)}`);
      }).catch(() => {});
    }
  });
  // Счётчик ДОШЕДШИХ отправок выработки из очереди: оборванная офлайн-попытка
  // (ERR_INTERNET_DISCONNECTED) сюда не попадает — считаем только завершённые.
  let flushedProductionSends = 0;
  let finishedCommands = 0;
  page.on('requestfinished', (request) => {
    if (!request.url().includes('/api/operator/mobile/command')) return;
    finishedCommands += 1;
    const raw = request.postData() ?? '';
    if (/log-production/.test(raw) && /"count":3[,}]/.test(raw)) flushedProductionSends += 1;
  });

  const commands: Record<string, any>[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/operator/mobile/command')) {
      try { commands.push(request.postDataJSON()); } catch { /* тело не нужно */ }
    }
  });

  await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(4000);
  let st = await stateOf(page);

  // Ж2: до открытия смены перезагружаем страницу — ложного «Черновик не
  // сохранится» быть не должно ни на одном экране (правка №10, Ж2).
  if (st.phase === 'IDENTITY' || st.phase === 'ADMISSION') {
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForTimeout(3000);
    dbChecks.push(`Ж2: после перезагрузки до открытия смены (фаза ${(await stateOf(page)).phase}) предупреждений черновика: ${await countDraftWarning(page)} (ожидается 0)`);
  }

  // ---------------------------------------------------------------- допуск
  if (st.phase === 'IDENTITY') {
    await page.getByText('Допуск к смене').first().waitFor({timeout: 30_000});
    if (!st.identity.ppe.confirmed) {
      await step(page, 'допуск: СИЗ', async () => {
        await page.locator('button.onx-step').filter({hasText: 'СИЗ'}).first().click();
        await page.getByText('Средства защиты').first().waitFor({timeout: 20_000});
        await screenEvidence(page, 'допуск-СИЗ', '10-01-допуск-сиз.png');
        await page.getByRole('button', {name: /Комплект в порядке|Подтвердить/}).click();
        await expect.poll(async () => (await stateOf(page)).phase, {timeout: 60_000}).not.toBe('IDENTITY');
      }, '10-01-допуск-сиз.png');
    }
    await step(page, 'допуск: инструктаж и знания', async () => {
      st = await stateOf(page);
      if (!st.identity.briefing.ok) {
        await page.locator('button.onx-step').filter({hasText: 'Ознакомление с инструкциями'}).first().click();
        await page.getByRole('button', {name: 'Прочитал и ознакомлен'}).click();
        await page.getByText('Допуск к смене').first().waitFor({timeout: 30_000});
      }
      st = await stateOf(page);
      if (!st.identity.knowledge.ok) {
        await page.locator('button.onx-step').filter({hasText: 'Проверка знаний'}).first().click();
        const attempts = new Map<string, number>();
        for (let guard = 0; guard < 130; guard++) {
          const finish = page.getByRole('button', {name: 'Записать результат'});
          if (await finish.count()) { await finish.click(); break; }
          const question = await page.locator('.onx p.text-base.font-semibold').first().textContent() ?? '';
          const tried = attempts.get(question) ?? 0;
          const options = page.locator('.onx div.space-y-2 > button');
          await options.nth(Math.min(tried, (await options.count()) - 1)).click();
          attempts.set(question, tried + 1);
          const forward = page.getByRole('button', {name: /Верно, дальше|Запомнил, дальше/});
          await forward.click();
          await page.waitForTimeout(120);
        }
        await page.getByText('Допуск к смене').first().waitFor({timeout: 30_000});
      }
      await screenEvidence(page, 'допуск-закрыт', '10-02-допуск-закрыт.png');
    }, '10-02-допуск-закрыт.png');
    await step(page, 'допуск: продолжить', async () => {
      if ((await stateOf(page)).phase !== 'IDENTITY') return; // фаза ушла сама — нажимать нечего
      await page.getByRole('button', {name: 'Продолжить'}).first().click();
      await wherePhase(page, 'ADMISSION', 60_000);
    });
  }

  // ---------------------------------------------------------------- приёмка
  st = await stateOf(page);
  if (st.phase === 'ADMISSION') {
    await step(page, 'приёмка: ночная смена', async () => {
      if (!(await page.getByText('Принять установку').first().isVisible().catch(() => false))) {
        await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
      }
      await page.getByText('Принять установку').first().waitFor({timeout: 30_000});
      await page.getByRole('button', {name: /Ночная/}).click();
      await screenEvidence(page, 'приёмка', '10-03-приёмка.png');
      await page.getByRole('button', {name: 'Принять установку'}).click();
      await expect.poll(async () => (await stateOf(page)).phase, {timeout: 60_000}).not.toBe('ADMISSION');
      st = await stateOf(page);
      const shiftType = db(`SELECT type FROM "Shift" WHERE id='${st.shift?.id}'`);
      dbChecks.push(`тип смены в базе: ${shiftType}`);
      expect(shiftType, 'сервер принял ночную смену').toBe('NIGHT');
      const warnAfterAccept = await countDraftWarning(page);
      dbChecks.push(`Ж2: сразу после приёмки предупреждений черновика: ${warnAfterAccept} (ожидается 0)`);
      expect(warnAfterAccept, 'ложного предупреждения о черновике нет').toBe(0);
    }, '10-03-приёмка.png');
  }

  // ------------------------------------------- осмотры фаз (до работы)
  const checklistShots: Record<string, string> = {
    PRESHIFT_INSPECTION: '10-04-осмотр-предсменный.png',
    SITE_READY: '10-05-площадка.png',
    STARTUP: '10-06-пуск.png',
  };
  for (const phase of ['PRESHIFT_INSPECTION', 'SITE_READY', 'STARTUP']) {
    st = await stateOf(page);
    if (st.phase !== phase) continue;
    await step(page, `осмотр фазы ${phase}`, async () => {
      await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
      await page.getByTestId('inspection-counter').waitFor({timeout: 60_000});
      await screenEvidence(page, phase, checklistShots[phase]);
      await completeChecklist(page);
      await expect.poll(async () => (await stateOf(page)).phase, {timeout: 90_000}).not.toBe(phase);
    }, checklistShots[phase]);
  }

  // ---------------------------------------------------------------- работа
  st = await stateOf(page);
  if (st.phase === 'WORK' && st.shift) {
    const shiftId: string = st.shift.id;

    await step(page, 'работа: экран', async () => {
      await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
      await page.getByText(/Связь есть|Связи нет/).first().waitFor({timeout: 60_000});
      await page.waitForTimeout(2000);
      // Если от прошлого прохода осталась открытая форма — вернёмся к списку.
      await ensureList(page);

      await screenEvidence(page, 'работа', '10-07-работа.png');
      await page.screenshot({path: path.join(OUT, 'после-работа.png'), fullPage: true});
      // Ж2: после правки ложное «Черновик не сохранится» не появляется.
      const warnOnWork = await countDraftWarning(page);
      dbChecks.push(`Ж2: на экране работы предупреждений черновика: ${warnOnWork} (ожидается 0)`);
      expect(warnOnWork, 'ложного предупреждения о черновике нет').toBe(0);
    }, '10-07-работа.png');

    await step(page, 'работа: записать сваи (10 шт)', async () => {
      const existing = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 10`));
      if (existing > 0) {
        results.push({step: 'работа: записать сваи (10 шт) (выполнено в предыдущем проходе)', status: 'OK', evidence: '10-08-сваи-записаны.png'});
        return;
      }
      await ensureList(page);
      const before = Number(db(`SELECT COALESCE(SUM(count),0) FROM "PileWork" WHERE "shiftId"='${shiftId}'`));
      await page.getByRole('button', {name: 'Записать сваи'}).first().click();
      await page.getByLabel('Сколько свай забито, шт').waitFor({timeout: 20_000});
      await page.locator('.onx-choice').first().click();
      await page.getByLabel('Сколько свай забито, шт').fill('10');
      await page.getByRole('button', {name: /^Записать( Автоподсчёт.*)?$/}).click();
      await expect.poll(
        async () => Number(db(`SELECT COALESCE(SUM(count),0) FROM "PileWork" WHERE "shiftId"='${shiftId}'`)),
        {timeout: 40_000, intervals: [1000, 2000]},
      ).toBe(before + 10);
      await page.waitForTimeout(800);
      await screenEvidence(page, 'сваи-записаны', '10-08-сваи-записаны.png');
    }, '10-08-сваи-записаны.png');

    await step(page, 'сервер: повтор команды с тем же clientCommandId (№6)', async () => {
      const row = db(`SELECT "clientCommandId", "pileGradeId", count FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 10 ORDER BY "createdAt" LIMIT 1`);
      if (!row) throw new Error('строка свай (count=10) не найдена — сначала выполните запись');
      const [clientCommandId, pileGradeId, count] = row.split('|');
      const body = {command: 'log-production', clientCommandId, shiftId, entry: {kind: 'PILES', pileGradeId, count: Number(count)}};
      const rowsBefore = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}'`));
      const replay = await context.request.post('/api/operator/mobile/command', {
        data: body,
        headers: {origin: BASE, referer: `${BASE}/operator/next`},
      });
      const rowsAfter = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}'`));
      dbChecks.push(`повтор log-production: ответ ${replay.status()}; записей до ${rowsBefore}, после ${rowsAfter}`);
      expect(rowsAfter, 'повтор команды не создаёт вторую запись').toBe(rowsBefore);
      expect(replay.status(), 'повтор принят идемпотентно (200)').toBe(200);
    });

    await step(page, 'работа: паспорт — три залога заполнены', async () => {
      await fillPassport(page, QA);
      await screenEvidence(page, 'паспорт-три-залога', '10-09-паспорт-три-залога.png');
      const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('piling.onx.drafts.v1')));
      dbChecks.push(`черновики в localStorage после ввода паспорта: ${draftKeys.length} ключей`);
    }, '10-09-паспорт-три-залога.png');

    await step(page, 'черновик: перезагрузка страницы (проверка №3)', async () => {
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(3000);
      // Форма паспорта живёт в DOM и скрытой (hidden) — до чтения значений
      // обязана быть ВИДИМА, иначе проверка читала бы скрытую пустую форму.
      const reopened = await page.getByPlaceholder('С-130').isVisible().catch(() => false);
      if (!reopened) throw new Error('после перезагрузки форма паспорта не открылась: черновик не восстановился (см. 10-10-паспорт-после-перезагрузки.png)');
      const value = await page.getByPlaceholder('С-130').inputValue().catch(() => '(поля нет)');
      const sets = await page.getByLabel('Ударов').count().catch(() => 0);
      await screenEvidence(page, 'паспорт-после-перезагрузки', '10-10-паспорт-после-перезагрузки.png');
      if (value === `${QA}-101` && sets === 3) return;
      throw new Error(`черновик не выжил перезагрузку: номер «${value}», залогов ${sets} — см. 10-10-паспорт-после-перезагрузки.png`);
    }, '10-10-паспорт-после-перезагрузки.png');

    await step(page, 'работа: паспорт — отправка после перезагрузки', async () => {
      await fillPassport(page, QA);
      const passportsBefore = Number(db(
        `SELECT COUNT(*) FROM "PilePassport" p JOIN "PileWork" w ON w.id = p."pileWorkId" WHERE w."shiftId"='${shiftId}'`));
      await page.getByRole('button', {name: 'Записать сваю с паспортом'}).click();
      await expect.poll(
        async () => Number(db(
          `SELECT COUNT(*) FROM "PilePassport" p JOIN "PileWork" w ON w.id = p."pileWorkId" WHERE w."shiftId"='${shiftId}'`)),
        {timeout: 40_000, intervals: [1000, 2000]},
      ).toBe(passportsBefore + 1);
    }, '10-09-паспорт-три-залога.png');

    await step(page, 'работа: простой — окно не раньше смены (Ж1) и деталь 400', async () => {
      if (Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`)) > 0) {
        results.push({step: 'работа: простой (выполнено в предыдущем проходе)', status: 'OK', evidence: '10-11-простой.png'});
        return;
      }
      await ensureList(page);
      const reason = (await stateOf(page)).dictionaries.downtimeReasons[0];
      const shiftStart = new Date((await stateOf(page)).shift.startedAt);
      const hhmm = (value: Date) => new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(value);
      await page.getByRole('button', {name: 'Записать простой'}).first().click();
      await page.getByText('Причина простоя').waitFor({timeout: 20_000});
      await page.getByRole('button', {name: reason.name, exact: true}).click();

      // (1) Начало раньше смены: сервер (верно) откажет — и экран обязан
      // показать ЕГО деталь, а не общее «проверьте заполненное» (правка Ж1б).
      await page.getByLabel('Начало').fill(hhmm(new Date(shiftStart.getTime() - 20 * 60_000)));
      await page.getByLabel('Конец').fill(hhmm(new Date(shiftStart.getTime() - 10 * 60_000)));
      await expect(page.getByText(/Длительность: \d+ мин/)).toBeVisible({timeout: 10_000});
      await page.getByRole('button', {name: /^Записать( Автоподсчёт.*)?$/}).click();
      const detail = page.getByText(/Простой не может начаться раньше смены — смена начата в \d{2}:\d{2}/).first();
      await detail.waitFor({timeout: 30_000});
      await screenEvidence(page, 'простой-400-деталь', '10-простой-400-деталь.png');
      dbChecks.push(`Ж1б: 400 показан деталью: «${((await detail.first().textContent()) ?? '').trim()}»`);

      // (2) Быстрый ввод: окно обрезано до начала смены (правка Ж1а).
      const quick = page.locator('button.onx-quiet', {hasText: /Простой (за последние 30 минут|с начала смены)/}).first();
      const quickText = ((await quick.textContent()) ?? '').trim();
      const elapsedMin = Math.floor((Date.now() - shiftStart.getTime()) / 60_000);
      dbChecks.push(`Ж1а: подпись кнопки «${quickText}»; смена идёт ${elapsedMin} мин`);
      await quick.click();
      await page.waitForTimeout(300);
      const startedValue = await page.getByLabel('Начало').inputValue();
      dbChecks.push(`Ж1а: Начало после кнопки — ${startedValue}, начало смены — ${hhmm(shiftStart)}`);
      if (elapsedMin < 30) {
        expect(quickText, 'окно обрезано до начала смены').toMatch(/с начала смены, \d+ мин/);
        const minOf = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
        const diff = Math.abs(minOf(startedValue) - minOf(hhmm(shiftStart)));
        expect(Math.min(diff, 1440 - diff), 'начало простоя — в пределах минуты от начала смены').toBeLessThanOrEqual(1);
      }
      await expect(page.getByText(/Длительность: \d+ мин/)).toBeVisible({timeout: 10_000});
      await page.screenshot({path: path.join(OUT, '10-11-простой.png'), fullPage: true});
      await page.screenshot({path: path.join(OUT, 'после-простой.png'), fullPage: true});

      // (3) Законная запись: интервал внутри смены уходит и ложится в базу.
      await page.getByRole('button', {name: /^Записать( Автоподсчёт.*)?$/}).click();
      await expect.poll(
        async () => Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`)),
        {timeout: 40_000, intervals: [1000, 2000]},
      ).toBeGreaterThanOrEqual(1);
      const dbStart = db(`SELECT "startedAt" FROM "ReportDowntime" WHERE "shiftId"='${shiftId}' ORDER BY "createdAt" DESC LIMIT 1`);
      dbChecks.push(`Ж1а: в базе начало простоя ${dbStart} (не раньше смены ${shiftStart.toISOString()})`);
      expect(new Date(dbStart).getTime(), 'простой не начинается раньше смены').toBeGreaterThanOrEqual(shiftStart.getTime() - 61_000);
    }, '10-11-простой.png');

    await step(page, 'работа: без связи — очередь и ровно одна запись', async () => {
      const before = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 3`));
      if (before > 0) {
        results.push({step: 'работа: без связи (выполнено в предыдущем проходе)', status: 'OK', evidence: '10-12-оффлайн-очередь.png'});
        return;
      }
      await ensureList(page);
      await context.setOffline(true);
      await expect(page.getByText('Связи нет — записи сохраняются на устройстве')).toBeVisible({timeout: 20_000});
      await page.getByRole('button', {name: 'Записать сваи'}).first().click();
      await page.getByLabel('Сколько свай забито, шт').waitFor({timeout: 20_000});
      await page.locator('.onx-choice').first().click();
      await page.getByLabel('Сколько свай забито, шт').fill('3');
      await page.getByRole('button', {name: /^Записать( Автоподсчёт.*)?$/}).click();
      await expect(page.getByTestId('offline-queue-banner')).toBeVisible({timeout: 20_000});
      await expect(page.getByText(/Записано на устройстве|сохранено на устройстве/)).toBeVisible({timeout: 20_000});
      await screenEvidence(page, 'оффлайн-очередь', '10-12-оффлайн-очередь.png');

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(
        async () => Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 3`)),
        {timeout: 60_000, intervals: [1000, 2000, 3000]},
      ).toBe(before + 1);
      const queuedSends = commands.filter((c) => c.command === 'log-production' && c.entry?.count === 3).length;
      dbChecks.push(`очередь: записей count=3 после отправки — ${before + 1}; запросов count=3 в сети — ${queuedSends}; завершённых команд всего — ${finishedCommands}; дошедших count=3 — ${flushedProductionSends}`);
      expect(queuedSends, 'отправка записи из очереди состоялась (сорвавшаяся попытка + отправка при связи)').toBeGreaterThanOrEqual(1);
    }, '10-12-оффлайн-очередь.png');

    await step(page, 'работа: завершение (двойное нажатие — одна команда)', async () => {
      await ensureList(page);
      await page.getByRole('button', {name: 'Завершить работу'}).click();
      const confirm = page.getByRole('button', {name: 'Да, работа завершена'});
      await confirm.waitFor({timeout: 20_000});
      await screenEvidence(page, 'завершение-работы', '10-13-завершение-работы.png');
      const before = commands.filter((c) => c.command === 'finish-work').length;
      await confirm.dblclick();
      await wherePhase(page, 'CLOSING', 90_000);
      const after = commands.filter((c) => c.command === 'finish-work').length;
      dbChecks.push(`finish-work: два нажатия — команд ${after - before}`);
      expect(after - before, 'двойное нажатие шлёт одну команду').toBe(1);
    }, '10-13-завершение-работы.png');
  }

  // ---------------------------------------------------------------- закрытие
  st = await stateOf(page);
  if (st.phase === 'CLOSING') {
    await step(page, 'закрытие: ЕО после работы приходит и выполняется', async () => {
      await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(2500);
      const eo = (await stateOf(page)).checklists.find((c: any) => c.stage === 'EO_AFTER');
      dbChecks.push(`EO_AFTER в конце смены: ${eo ? 'пришёл' : 'НЕ пришёл'}`);
      expect(eo, 'сервер отдал чек-лист ЕО после работы').toBeTruthy();
      if (!eo.done) {
        await page.getByRole('button', {name: 'Выполнить осмотр после работы'}).click();
        await page.getByTestId('inspection-counter').waitFor({timeout: 60_000});
        await screenEvidence(page, 'ео-после-работы', '10-14-ео-после-работы.png');
        await completeChecklist(page);
      }
    }, '10-14-ео-после-работы.png');

    await step(page, 'закрытие: заметка и отправка отчёта', async () => {
      const closeButton = page.getByRole('button', {name: /Закрыть смену и отправить отчёт/}).first();
      await closeButton.waitFor({timeout: 90_000});
      const note = page.getByPlaceholder(/осталось 4 сваи|Незаконченная работа/);
      if ((await note.count()) > 0) {
        await note.fill(`${QA}: проверить натяжение гусениц утром`);
      }
      await screenEvidence(page, 'закрытие-смены', '10-15-закрытие-смены.png');
      await page.screenshot({path: path.join(OUT, 'после-закрытие.png'), fullPage: true});
      await closeButton.click();
      await expect(page.getByText(/Записано: сервер принял запись/)).toBeVisible({timeout: 90_000});
      // После закрытия сервер может сразу открыть следующий цикл (ADMISSION
      // новой производственной даты) — важно лишь, что закрытие завершилось.
      await expect.poll(async () => (await stateOf(page)).phase, {timeout: 90_000, intervals: [800, 1500, 2500]}).not.toBe('CLOSING');
      dbChecks.push(`фаза после закрытия: ${(await stateOf(page)).phase}`);
      await screenEvidence(page, 'смена-закрыта', '10-16-смена-закрыта.png');
    }, '10-16-смена-закрыта.png');
  }

  // ---------------------------------------------------------------- итоги
  fs.mkdirSync(OUT, {recursive: true});
  // Намеренный 400 (проверка Ж1б) даёт ожидаемый console-артефакт — не считаем
  // его ошибкой экрана, но сохраняем в отчёте отдельно.
  const expectedConsole = consoleErrors.filter((text) => /status of 400/.test(text));
  const unexpectedConsole = consoleErrors.filter((text) => !/status of 400/.test(text));
  results.push({
    step: 'консоль браузера',
    status: unexpectedConsole.length === 0 ? 'OK' : 'ДЕФЕКТ',
    evidence: unexpectedConsole.length === 0
      ? `ошибок нет${expectedConsole.length ? `; ожидаемых артефактов 400: ${expectedConsole.length}` : ''}`
      : `${unexpectedConsole.length} — см. console-errors10.txt`,
  });
  fs.writeFileSync(path.join(OUT, 'walk10-report.json'), JSON.stringify({
    base: BASE, executedAt: new Date().toISOString(), steps: results, dbChecks, checks: checksAll,
    consoleErrors, expectedConsole, unexpectedConsole, netErrors,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'console-errors10.txt'),
    consoleErrors.length ? consoleErrors.join('\n') : 'Консольных ошибок нет', 'utf8');

  console.log('=== СВОДКА ПРОГОНА №10 ===');
  for (const row of results) console.log(`${row.status}\t${row.step}\t${row.evidence}`);
  console.log('=== СВЕРКИ БАЗЫ ===');
  for (const row of dbChecks) console.log(row);
  await context.close();
});
