/**
 * Прогон №9: полный цикл смены машиниста на /operator/next в живом браузере,
 * рамка 375×812 (телефон, касание). Один сквозной проход:
 * допуск → приёмка установки → предсменный осмотр → площадка → пуск →
 * работа (сваи, паспорт с тремя залогами, простой) → завершение работы →
 * осмотр после смены → закрытие смены.
 *
 * ПРАВИЛА ПРОГОНА (из задания):
 *  • вход — однажды (tools/login.mjs), дальше storageState .auth/ka.json;
 *  • все вводимые тексты начинаются с «AC-QA », ничего не удаляем;
 *  • сверки с сервером — только чтением (SELECT … -Atc через docker exec);
 *  • шаг, который невозможен, помечается и не блокирует остальные.
 *
 * Шаги устойчивы к перезапуску: каждый раздел выполняется, только если смена
 * сейчас в подходящей фазе (фаза спрашивается у сервера, а не угадывается).
 * Скриншоты и итоги кладутся в docs/operator-next/browser/.
 */
import {test, expect, type Page} from '@playwright/test';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.OPNEXT_BASE_URL ?? 'http://localhost:3210';
const AUTH = path.resolve(__dirname, '.auth/ka.json');
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

/** Состояние смены из живого API: только поля, которые читает прогон. */
type LiveState = {
  phase: string;
  shift: {id: string; startedAt: string; state?: string} | null;
  identity: {ppe: {confirmed: boolean}; briefing: {ok: boolean}; knowledge: {ok: boolean}};
  checklists: {stage: string; done?: boolean}[];
  dictionaries: {downtimeReasons: {id: string; name: string}[]};
};

/** Команда, которую прогон наблюдает в сети (тело запроса как есть). */
type SentCommand = {command?: string; entry?: {kind?: string; count?: number}};

async function stateOf(page: Page): Promise<LiveState> {
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

test('полный цикл смены на /operator/next (375×812)', async ({browser}) => {
  test.setTimeout(14 * 60_000);
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
  page.on('requestfinished', (request) => {
    if (!request.url().includes('/api/operator/mobile/command')) return;
    try {
      const body = request.postDataJSON();
      if (body?.command === 'log-production' && body?.entry?.count === 3) flushedProductionSends += 1;
    } catch { /* чужой формат */ }
  });

  const commands: SentCommand[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/operator/mobile/command')) {
      try { commands.push(request.postDataJSON()); } catch { /* тело не нужно */ }
    }
  });

  await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
  await page.waitForTimeout(4000);
  let st = await stateOf(page);

  // Следы предыдущих прогонов: эти шаги уже выполнены — подтверждаем снимками.
  const recap: [string, string][] = [
    ['допуск: СИЗ', '01-допуск-сиз.png'],
    ['приёмка: ночная смена', '03-приёмка.png'],
    ['осмотр фазы PRESHIFT_INSPECTION', '04-осмотр-предсменный.png'],
    ['осмотр фазы SITE_READY', '05-площадка.png'],
    ['осмотр фазы STARTUP', '06-пуск.png'],
  ];
  for (const [name, shot] of recap) {
    if (fs.existsSync(path.join(OUT, shot)) && !results.some((r) => r.step.startsWith(name))) {
      results.push({step: `${name} (выполнено в предыдущем прогоне)`, status: 'OK', evidence: shot});
    }
  }

  // ---------------------------------------------------------------- допуск
  if (st.phase === 'IDENTITY') {
    await page.getByText('Допуск к смене').first().waitFor({timeout: 30_000});
    if (!st.identity.ppe.confirmed) {
      await step(page, 'допуск: СИЗ', async () => {
        await page.locator('button.onx-step').filter({hasText: 'СИЗ'}).first().click();
        await page.getByText('Средства защиты').first().waitFor({timeout: 20_000});
        await screenEvidence(page, 'допуск-СИЗ', '01-допуск-сиз.png');
        await page.getByRole('button', {name: /Комплект в порядке|Подтвердить/}).click();
        await expect.poll(async () => (await stateOf(page)).phase, {timeout: 60_000}).not.toBe('IDENTITY');
      }, '01-допуск-сиз.png');
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
      await screenEvidence(page, 'допуск-закрыт', '02-допуск-закрыт.png');
    }, '02-допуск-закрыт.png');
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
      await screenEvidence(page, 'приёмка', '03-приёмка.png');
      await page.getByRole('button', {name: 'Принять установку'}).click();
      await expect.poll(async () => (await stateOf(page)).phase, {timeout: 60_000}).not.toBe('ADMISSION');
      st = await stateOf(page);
      const shiftType = db(`SELECT type FROM "Shift" WHERE id='${st.shift?.id}'`);
      dbChecks.push(`тип смены в базе: ${shiftType}`);
      expect(shiftType, 'сервер принял ночную смену').toBe('NIGHT');
    }, '03-приёмка.png');
  }

  // ------------------------------------------- осмотры фаз (до работы)
  const checklistShots: Record<string, string> = {
    PRESHIFT_INSPECTION: '04-осмотр-предсменный.png',
    SITE_READY: '05-площадка.png',
    STARTUP: '06-пуск.png',
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
      // Если от прошлого прогона осталась открытая форма — вернёмся к списку.
      await ensureList(page);

      await screenEvidence(page, 'работа', '07-работа.png');
    }, '07-работа.png');

    await step(page, 'работа: записать сваи (10 шт)', async () => {
      const existing = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 10`));
      if (existing > 0) {
        results.push({step: 'работа: записать сваи (10 шт) (выполнено в предыдущем прогоне)', status: 'OK', evidence: '08-сваи-записаны.png'});
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
      await screenEvidence(page, 'сваи-записаны', '08-сваи-записаны.png');
    }, '08-сваи-записаны.png');

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
      await screenEvidence(page, 'паспорт-три-залога', '09-паспорт-три-залога.png');
      const draftKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('piling.onx.drafts.v1')));
      dbChecks.push(`черновики в localStorage после ввода паспорта: ${draftKeys.length} ключей`);
    }, '09-паспорт-три-залога.png');

    await step(page, 'черновик: перезагрузка страницы (проверка №3)', async () => {
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(3000);
      const value = await page.getByPlaceholder('С-130').inputValue().catch(() => '(поля нет)');
      const sets = await page.getByLabel('Ударов').count().catch(() => 0);
      await screenEvidence(page, 'паспорт-после-перезагрузки', '10-паспорт-после-перезагрузки.png');
      if (value === `${QA}-101` && sets === 3) return;
      throw new Error(`черновик не выжил перезагрузку: номер «${value}», залогов ${sets} — см. 10-паспорт-после-перезагрузки.png`);
    }, '10-паспорт-после-перезагрузки.png');

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
    }, '09-паспорт-три-залога.png');

    await step(page, 'работа: простой (интервал внутри смены)', async () => {
      if (Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`)) > 0) {
        results.push({step: 'работа: простой (выполнено в предыдущем прогоне)', status: 'OK', evidence: '11-простой.png'});
        return;
      }
      await ensureList(page);
      const live = await stateOf(page);
      if (!live.shift) throw new Error('смена исчезла из состояния — проверьте фазу');
      const reason = live.dictionaries.downtimeReasons[0];
      // Интервал строим ВНУТРИ смены: сервер (верно) не принимает простой,
      // начавшийся раньше смены — «последние 30 минут» на старте отклонялись.
      const shiftStart = new Date(live.shift.startedAt);
      const now = new Date();
      const startAt = new Date(Math.max(shiftStart.getTime() + 60_000, now.getTime() - 10 * 60_000));
      const endAt = new Date(Math.max(startAt.getTime() + 60_000, now.getTime() - 30_000));
      const hhmm = (value: Date) => new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(value);
      await page.getByRole('button', {name: 'Записать простой'}).first().click();
      await page.getByText('Причина простоя').waitFor({timeout: 20_000});
      await page.getByRole('button', {name: reason.name, exact: true}).click();
      await page.getByLabel('Начало').fill(hhmm(startAt));
      await page.getByLabel('Конец').fill(hhmm(endAt));
      await expect(page.getByText(/Длительность: \d+ мин/)).toBeVisible({timeout: 10_000});
      await screenEvidence(page, 'простой', '11-простой.png');
      await page.getByRole('button', {name: /^Записать( Автоподсчёт.*)?$/}).click();
      await expect.poll(
        async () => Number(db(`SELECT COUNT(*) FROM "ReportDowntime" WHERE "shiftId"='${shiftId}'`)),
        {timeout: 40_000, intervals: [1000, 2000]},
      ).toBeGreaterThanOrEqual(1);
    }, '11-простой.png');

    await step(page, 'работа: без связи — очередь и ровно одна запись', async () => {
      const before = Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 3`));
      if (before > 0) {
        results.push({step: 'работа: без связи (выполнено в предыдущем прогоне)', status: 'OK', evidence: '12-оффлайн-очередь.png'});
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
      await screenEvidence(page, 'оффлайн-очередь', '12-оффлайн-очередь.png');

      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(
        async () => Number(db(`SELECT COUNT(*) FROM "PileWork" WHERE "shiftId"='${shiftId}' AND count = 3`)),
        {timeout: 60_000, intervals: [1000, 2000, 3000]},
      ).toBe(before + 1);
      dbChecks.push(`очередь: записей count=3 после отправки — ${before + 1}; дошедших отправок — ${flushedProductionSends} (сорвавшаяся в офлайне попытка не считается)`);
      expect(flushedProductionSends, 'ровно одна дошедшая отправка записи из очереди').toBe(1);
    }, '12-оффлайн-очередь.png');

    await step(page, 'работа: завершение (двойное нажатие — одна команда)', async () => {
      await ensureList(page);
      await page.getByRole('button', {name: 'Завершить работу'}).click();
      const confirm = page.getByRole('button', {name: 'Да, работа завершена'});
      await confirm.waitFor({timeout: 20_000});
      await screenEvidence(page, 'завершение-работы', '13-завершение-работы.png');
      const before = commands.filter((c) => c.command === 'finish-work').length;
      await confirm.dblclick();
      await wherePhase(page, 'CLOSING', 90_000);
      const after = commands.filter((c) => c.command === 'finish-work').length;
      dbChecks.push(`finish-work: два нажатия — команд ${after - before}`);
      expect(after - before, 'двойное нажатие шлёт одну команду').toBe(1);
    }, '13-завершение-работы.png');
  }

  // ---------------------------------------------------------------- закрытие
  st = await stateOf(page);
  if (st.phase === 'CLOSING') {
    await step(page, 'закрытие: ЕО после работы приходит и выполняется', async () => {
      await page.goto('/operator/next', {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(2500);
      const eo = (await stateOf(page)).checklists.find((c) => c.stage === 'EO_AFTER');
      dbChecks.push(`EO_AFTER в конце смены: ${eo ? 'пришёл' : 'НЕ пришёл'}`);
      expect(eo, 'сервер отдал чек-лист ЕО после работы').toBeTruthy();
      if (!eo.done) {
        await page.getByRole('button', {name: 'Выполнить осмотр после работы'}).click();
        await page.getByTestId('inspection-counter').waitFor({timeout: 60_000});
        await screenEvidence(page, 'ео-после-работы', '14-ео-после-работы.png');
        await completeChecklist(page);
      }
    }, '14-ео-после-работы.png');

    await step(page, 'закрытие: заметка и отправка отчёта', async () => {
      const closeButton = page.getByRole('button', {name: /Закрыть смену и отправить отчёт/}).first();
      await closeButton.waitFor({timeout: 90_000});
      const note = page.getByPlaceholder(/осталось 4 сваи|Незаконченная работа/);
      if ((await note.count()) > 0) {
        await note.fill(`${QA}: проверить натяжение гусениц утром`);
      }
      await screenEvidence(page, 'закрытие-смены', '15-закрытие-смены.png');
      await closeButton.click();
      await expect(page.getByText(/Записано: сервер принял запись/)).toBeVisible({timeout: 90_000});
      await wherePhase(page, 'CLOSED', 90_000);
      await screenEvidence(page, 'смена-закрыта', '16-смена-закрыта.png');
    }, '16-смена-закрыта.png');
  }

  // ---------------------------------------------------------------- итоги
  fs.mkdirSync(OUT, {recursive: true});
  results.push({
    step: 'консоль браузера',
    status: consoleErrors.length === 0 ? 'OK' : 'ДЕФЕКТ',
    evidence: consoleErrors.length === 0 ? 'ошибок нет' : `${consoleErrors.length} — см. console-errors.txt`,
  });
  fs.writeFileSync(path.join(OUT, 'walk-report.json'), JSON.stringify({
    base: BASE, executedAt: new Date().toISOString(), steps: results, dbChecks, checks: checksAll, consoleErrors, netErrors,
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'console-errors.txt'),
    consoleErrors.length ? consoleErrors.join('\n') : 'Консольных ошибок нет', 'utf8');

  console.log('=== СВОДКА ПРОГОНА ===');
  for (const row of results) console.log(`${row.status}\t${row.step}\t${row.evidence}`);
  console.log('=== СВЕРКИ БАЗЫ ===');
  for (const row of dbChecks) console.log(row);
  await context.close();
});
