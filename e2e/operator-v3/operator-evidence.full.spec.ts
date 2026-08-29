import {expect, test, type APIRequestContext, type Browser, type Page, type TestInfo} from '@playwright/test';

type Credentials = {email: string; password: string};
type Scenario = {
  operator: Credentials;
  mechanic?: Credentials;
  verifier?: Credentials;
  responsible?: Credentials;
  expectedEquipment?: string;
};
type Receipt = {result: 'COMPLETED'; replayed: boolean; commandId: string; newVersion: number; workplace: Record<string, any>};

const fixtureUrl = process.env.OPERATOR_V3_E2E_FIXTURE_URL;
const appBaseUrl = process.env.BASE_URL ?? 'http://localhost:3000';

async function prepare(request: APIRequestContext, name: string): Promise<Scenario> {
  expect(fixtureUrl, 'Задайте OPERATOR_V3_E2E_FIXTURE_URL: выпускной шлюз не использует общую изменяемую смену').toBeTruthy();
  const response = await request.post(`${fixtureUrl!.replace(/\/$/, '')}/${name}`);
  expect(response.ok(), `Не удалось подготовить сценарий ${name}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<Scenario>;
}

async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/электронная почта|email/i).fill(credentials.email);
  await page.getByLabel(/пароль|password/i).fill(credentials.password);
  await page.getByRole('button', {name: /войти/i}).click();
  await page.goto('/operator/v3');
  await expect(page.getByTestId('operator-v3-workplace')).toBeVisible();
}

async function workplace(page: Page): Promise<Record<string, any>> {
  const response = await page.request.get('/api/operator/v3/workplace');
  expect(response.ok()).toBeTruthy();
  const envelope = await response.json();
  return envelope.data ?? envelope['данные'] ?? envelope;
}

async function expectSecondSession(browser: Browser, credentials: Credentials, commandId: string): Promise<void> {
  const context = await browser.newContext({baseURL: appBaseUrl, locale: 'ru-RU'});
  const page = await context.newPage();
  try {
    await signIn(page, credentials);
    const response = await page.request.get(`/api/operator/v3/events?commandId=${encodeURIComponent(commandId)}`);
    expect(response.ok()).toBeTruthy();
    const envelope = await response.json();
    const events = envelope.data?.events ?? envelope.events ?? envelope.data ?? envelope;
    expect(events.filter((event: {commandId?: string}) => event.commandId === commandId)).toHaveLength(1);
  } finally {
    await context.close();
  }
}

async function commandEvidence(page: Page, browser: Browser, credentials: Credentials, action: RegExp, info: TestInfo): Promise<Receipt> {
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/api/operator/v3/'));
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/operator/v3/'));
  await page.getByRole('button', {name: action}).click();
  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.ok()).toBeTruthy();
  const receipt = await response.json() as Receipt;
  expect(receipt).toMatchObject({result: 'COMPLETED', replayed: false, commandId: expect.any(String), newVersion: expect.any(Number), workplace: expect.any(Object)});
  expect(request.headerValue('idempotency-key')).toBe(receipt.commandId);
  expect(request.postDataJSON()).toMatchObject({commandId: receipt.commandId, expectedVersion: expect.any(Number)});
  await info.attach(`запрос-${receipt.commandId}`, {body: request.postData() ?? '', contentType: 'application/json'});
  await info.attach(`квитанция-${receipt.commandId}`, {body: JSON.stringify(receipt, null, 2), contentType: 'application/json'});

  const eventsResponse = await page.request.get(`/api/operator/v3/events?commandId=${encodeURIComponent(receipt.commandId)}`);
  expect(eventsResponse.ok()).toBeTruthy();
  const eventsEnvelope = await eventsResponse.json();
  const events = eventsEnvelope.data?.events ?? eventsEnvelope.events ?? eventsEnvelope.data ?? eventsEnvelope;
  expect(events.filter((event: {commandId?: string}) => event.commandId === receipt.commandId)).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('operator-v3-workplace')).toBeVisible();
  await expectSecondSession(browser, credentials, receipt.commandId);
  return receipt;
}

async function uploadPhoto(page: Page): Promise<void> {
  await page.getByLabel(/фотограф/i).setInputFiles({name: 'доказательство.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex')});
}

test.describe.serial('Оператор v3 — полный выпускной шлюз', () => {
  test('1. обычная смена проходит все семь фаз и сохраняется во втором сеансе', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'ordinary-shift');
    await signIn(page, scenario.operator);
    await expect(page.getByTestId('operator-v3-phase-route').getByRole('listitem')).toHaveCount(7);
    for (const action of [/принять назначение/i, /получить установку/i, /завершить проверку/i, /подтвердить рабочую зону/i,
      /сохранить моточасы/i, /начать смену/i, /завершить работу/i, /завершить послесменную проверку/i,
      /отправить отчёт/i, /передать установку/i, /принять передачу/i]) {
      await commandEvidence(page, browser, scenario.operator, action, info);
    }
    expect((await workplace(page)).phase.number).toBe(7);
  });

  test('2. замечание требует фотографию, осознанный пуск, журнал и передачу', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'allowed-with-notes');
    await signIn(page, scenario.operator);
    await page.getByRole('button', {name: /сообщить о дефекте/i}).click();
    await page.getByLabel(/необычный шум/i).check();
    await expect(page.getByRole('button', {name: /зарегистрировать дефект/i})).toBeDisabled();
    await uploadPhoto(page);
    await commandEvidence(page, browser, scenario.operator, /зарегистрировать дефект/i, info);
    await expect(page.getByText(/работа разрешена с замечаниями/i)).toBeVisible();
    await commandEvidence(page, browser, scenario.operator, /понимаю замечания и начинаю смену/i, info);
    await expect(page.getByTestId('operator-v3-journal')).toContainText(/необычный шум/i);
    await expect(page.getByTestId('operator-v3-handover')).toContainText(/необычный шум/i);
  });

  test('3. критический дефект запрещает пуск до ремонта и независимой проверки', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'critical-defect');
    expect(scenario.mechanic).toBeDefined(); expect(scenario.verifier).toBeDefined();
    await signIn(page, scenario.operator);
    await page.getByRole('button', {name: /сообщить о дефекте/i}).click();
    await page.getByLabel(/утечка/i).check(); await uploadPhoto(page);
    await commandEvidence(page, browser, scenario.operator, /зарегистрировать дефект/i, info);
    await expect(page.getByText(/работа запрещена/i)).toBeVisible();
    await expect(page.getByRole('button', {name: /начать смену/i})).toHaveCount(0);

    const mechanic = await browser.newPage(); await signIn(mechanic, scenario.mechanic!);
    await commandEvidence(mechanic, browser, scenario.mechanic!, /завершить ремонт/i, info); await mechanic.close();
    const verifier = await browser.newPage(); await signIn(verifier, scenario.verifier!);
    await commandEvidence(verifier, browser, scenario.verifier!, /подтвердить устранение/i, info); await verifier.close();
    await page.reload();
    await expect(page.getByText(/работа разрешена/i)).toBeVisible();
  });

  test('4. опасное событие блокирует производство до остановки, устранения и новой оценки', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'safety-incident');
    await signIn(page, scenario.operator);
    await page.getByRole('button', {name: /опасное событие/i}).click();
    await commandEvidence(page, browser, scenario.operator, /зарегистрировать событие/i, info);
    await expect(page.getByText(/требуется безопасная остановка/i)).toBeVisible();
    await expect(page.getByRole('button', {name: /записать выработку/i})).toHaveCount(0);
    await commandEvidence(page, browser, scenario.operator, /подтвердить безопасную остановку/i, info);
    await commandEvidence(page, browser, scenario.operator, /запросить повторную оценку/i, info);
    await commandEvidence(page, browser, scenario.operator, /возобновить работу/i, info);
    await expect(page.getByRole('button', {name: /записать выработку/i})).toBeVisible();
  });

  test('5. потеря связи переживает перезапуск и согласовывает каждую запись один раз', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'offline-recovery');
    await signIn(page, scenario.operator);
    await page.context().setOffline(true);
    await page.getByRole('button', {name: /добавить фотографию/i}).click(); await uploadPhoto(page);
    await page.getByRole('button', {name: /сохранить на устройстве/i}).click();
    await expect(page.getByText(/сохранено на устройстве/i)).toBeVisible();
    await page.reload({waitUntil: 'commit'}).catch(() => undefined);
    await page.context().setOffline(false); await page.reload();
    const receipt = await commandEvidence(page, browser, scenario.operator, /передать сохранённые данные/i, info);
    await expect(page.getByText(/все данные переданы/i)).toBeVisible();
    expect((await workplace(page)).revision).toBe(receipt.workplace.revision);
  });

  test('6. устаревшая команда второго устройства не перезаписывает первую', async ({browser, request}, info) => {
    const scenario = await prepare(request, 'two-device-conflict');
    const first = await browser.newPage(); const second = await browser.newPage();
    await signIn(first, scenario.operator); await signIn(second, scenario.operator);
    const accepted = await commandEvidence(first, browser, scenario.operator, /принять назначение/i, info);
    const responsePromise = second.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/operator/v3/commands/'));
    await second.getByRole('button', {name: /принять назначение/i}).click();
    const response = await responsePromise;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({code: 'VERSION_CONFLICT', message: expect.stringMatching(/[А-Яа-яЁё]/)});
    await expect(second.getByRole('alert')).toContainText(/состояние изменилось|противоречие/i);
    expect((await workplace(first)).revision).toBe(accepted.workplace.revision);
    await first.close(); await second.close();
  });

  test('7. передачу без принимающего закрывает только уполномоченный с причиной', async ({page, browser, request}, info) => {
    const scenario = await prepare(request, 'handover-without-recipient');
    expect(scenario.responsible).toBeDefined();
    await signIn(page, scenario.operator);
    await expect(page.getByRole('button', {name: /закрыть без принимающего/i})).toHaveCount(0);
    await commandEvidence(page, browser, scenario.operator, /передать установку/i, info);
    await expect(page.getByText(/ожидает принятия/i)).toBeVisible();

    const responsible = await browser.newPage(); await signIn(responsible, scenario.responsible!);
    await responsible.getByRole('button', {name: /закрыть без принимающего/i}).click();
    await responsible.getByLabel(/причина/i).fill('Принимающий оператор не назначен ответственным руководителем');
    await commandEvidence(responsible, browser, scenario.responsible!, /подтвердить закрытие/i, info);
    await responsible.close();
    await page.reload();
    await expect(page.getByText(/закрыта без принимающего/i)).toBeVisible();
  });
});
