import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {operatorWorkplaceWireSchema} from '../../src/components/piling/operator-v3/api/wire-contracts';

const operatorEmail = process.env.OPERATOR_EMAIL;
const operatorPassword = process.env.OPERATOR_PASSWORD;
const enabled = process.env.OPERATOR_V3_OFFLINE_PREFLIGHT === 'true' && Boolean(operatorEmail && operatorPassword);

const workplace = {
  revision: 'v3-offline-1', serverTime: '2026-08-28T06:00:00.000Z',
  operator: {id: 'operator-offline-1', name: 'Испытательный оператор', blockers: [], warnings: []},
  assignments: [], equipment: {id: 'equipment-1', name: 'Испытательная установка', model: 'СП-49', engineHoursTotal: 100, nextMaintenanceAtHours: 120, site: {id: 'site-1', name: 'Испытательный участок'}},
  shift: {id: 'shift-offline-1', state: 'WORKING', version: 7, type: 'DAY', productionDate: '2026-08-28', startedAt: '2026-08-28T05:00:00.000Z'},
  phase: {number: 5, name: 'Работа', state: 'CURRENT', progress: null, explanation: 'Разрешён безопасный сбор данных'},
  phases: ['Допуск оператора', 'Получение установки', 'Проверка до работы', 'Готовность и пуск', 'Работа', 'Завершение', 'Передача'].map((name, index) => ({number: index + 1, name, state: index < 4 ? 'COMPLETED' : index === 4 ? 'CURRENT' : 'UPCOMING', progress: null, explanation: null})),
  workMode: 'WORKING', readiness: {decision: 'ALLOWED', freshness: 'CURRENT', label: 'Работа разрешена', calculatedAt: '2026-08-28T05:00:00.000Z', ruleVersion: 'rules-1', blockers: [], warnings: [], evidence: []},
  actions: [], primaryAction: {id: 'offline-check', label: 'Сохранить проверку без связи', kind: 'COMMAND', offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: [], confirmation: null, method: 'POST', route: '/api/operator/v3/commands/offline-check', expectedVersion: 7},
  persistentActions: [], inspections: [], workZone: null, meter: {knownToday: true, current: 100, source: 'reading', recordedAt: '2026-08-28T05:00:00.000Z'},
  activeInterval: null, production: {pilesToday: 0, entries: [], options: {piles: [], pickets: [], workTypes: []}, journal: []}, defects: [], incidents: [], maintenance: null, report: null,
  handover: {incoming: null, outgoing: null}, authority: {canCloseWithoutRecipient: false},
  contacts: {dispatcher: null, mechanic: null, emergency: null}, sync: {state: 'SYNCED', pending: 0, authorizationExpiresAt: null},
};

async function signIn(page: Page) {
  if (!operatorEmail || !operatorPassword) throw new Error('Не заданы испытательные учётные данные оператора');
  await page.goto('/login');
  await page.getByLabel(/электронная почта|email/i).fill(operatorEmail);
  await page.getByRole('textbox', {name: /^Пароль$/i}).fill(operatorPassword);
  await page.getByRole('button', {name: /войти/i}).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

interface ReceivedCommand {commandId: string; idempotencyKey: string | undefined; route: string}

async function mockWorkplace(context: BrowserContext, received: ReceivedCommand[]) {
  await context.route('**/api/operator/v3/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/operator/v3/workplace') {
      await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({data: workplace})});
      return;
    }
    const idempotencyKey = request.headers()['idempotency-key'];
    const commandId = idempotencyKey ?? 'идентификатор-не-передан';
    received.push({commandId, idempotencyKey, route: pathname});
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({data: {workplace}})});
  });
}

test.describe('Оператор v3 — защищённая работа при потере связи', () => {
  test.skip(!enabled, 'Нужны OPERATOR_V3_OFFLINE_PREFLIGHT=true и испытательные учётные данные');

  test('сохраняет команду до сети, переживает новую вкладку и отправляет один раз', async ({context, page}) => {
    const parsedWorkplace = operatorWorkplaceWireSchema.safeParse(workplace);
    expect(parsedWorkplace.success, parsedWorkplace.success ? '' : JSON.stringify(parsedWorkplace.error.issues)).toBe(true);
    const received: ReceivedCommand[] = [];
    const diagnostics: string[] = [];
    context.on('request', (request) => {
      if (request.url().includes('/api/operator/v3/')) diagnostics.push(`запрос ${request.method()} ${request.url()}`);
    });
    context.on('requestfailed', (request) => {
      if (request.url().includes('/api/operator/v3/')) diagnostics.push(`сбой ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'неизвестно'}`);
    });
    await signIn(page);
    await mockWorkplace(context, received);
    await page.goto('/operator/v3');
    await expect(page.getByRole('heading', {name: 'Синхронизация действий'})).toBeVisible();
    const restored = await context.newPage();
    await restored.goto('/operator/v3');
    await expect(restored.getByRole('heading', {name: 'Синхронизация действий'})).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText('Нет связи — действия сохраняются на устройстве')).toBeVisible();
    await expect(restored.getByText('Нет связи — действия сохраняются на устройстве')).toBeVisible();
    await page.getByRole('button', {name: 'Сохранить проверку без связи'}).click();
    await expect(page.getByText(/сохранено на устройстве/i)).toBeVisible();
    expect(received).toHaveLength(0);

    await page.close();
    await context.setOffline(false);
    await restored.reload();
    try {
      await expect.poll(() => received.length, {timeout: 15_000}).toBe(1);
    } catch {
      throw new Error(diagnostics.join('\n') || 'Сетевых попыток не зарегистрировано');
    }
    await expect(restored.getByText('Связь с сервером доступна')).toBeVisible();
    await expect(restored.getByText('Всего на устройстве').locator('..').getByText('0')).toBeVisible();
    expect(received[0]?.idempotencyKey).toBe(received[0]?.commandId);
    expect(new Set(received.map((item) => item.commandId)).size).toBe(1);
  });
});
