// @vitest-environment node

import {beforeAll, describe, expect, it} from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire response is validated field by field below
type Json = Record<string, any>;

const baseUrl = process.env.OPERATOR_V3_TEST_BASE_URL ?? 'http://localhost:3000';
const password = process.env.OPERATOR_PASSWORD ?? 'operator123';
const statefulMutationEnabled = process.env.OPERATOR_V3_STATEFUL_PREFLIGHT === 'true';
let cookie = '';

const WORK_MODES = ['NOT_STARTED', 'WORKING', 'BREAK', 'DOWNTIME', 'MAINTENANCE', 'STOP_REQUIRED', 'STOPPED', 'FINISHED'];
const READINESS_DECISIONS = ['UNKNOWN', 'ALLOWED', 'ALLOWED_WITH_NOTES', 'DENIED'];
const READINESS_FRESHNESS = ['COLLECTING', 'CALCULATING', 'CURRENT', 'STALE', 'RECHECK_REQUIRED', 'FAILED'];
const SYNC_STATES = ['SYNCED', 'PENDING', 'SENDING', 'OFFLINE', 'CONFLICT', 'INTERVENTION_REQUIRED', 'AUTHORIZATION_EXPIRED'];

async function readJson(response: Response, expectedStatus = 200): Promise<Json> {
  const text = await response.text();
  expect(response.status, `${response.url}: ${text}`).toBe(expectedStatus);
  expect(response.headers.get('content-type'), `${response.url} должен вернуть JSON`).toMatch(/application\/json/i);
  return JSON.parse(text) as Json;
}

async function getWorkplace(query = ''): Promise<Json> {
  const envelope = await readJson(await fetch(`${baseUrl}/api/operator/v3/workplace${query}`, {headers: {cookie}}));
  return envelope.data ?? envelope['данные'] ?? envelope;
}

function expectRussian(value: unknown, field: string): void {
  expect(String(value), `${field} должен содержать русскую подпись`).toMatch(/[А-Яа-яЁё]/);
}

function eventsFrom(envelope: Json): Json[] {
  const events = envelope.data?.events ?? envelope.events ?? envelope.data ?? envelope;
  expect(events, 'Маршрут событий должен вернуть массив').toEqual(expect.any(Array));
  return events as Json[];
}

describe.sequential('межслойный договор рабочего места оператора v3', () => {
  beforeAll(async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: 'operator@piling.ru', password}),
    });
    await readJson(login);
    cookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    expect(cookie, 'Нужен настоящий сеанс пользователя с ролью оператора').not.toBe('');
  });

  it('не допускает чтение рабочего места без настоящего сеанса', async () => {
    const body = await readJson(await fetch(`${baseUrl}/api/operator/v3/workplace`), 401);
    expect(body.code).toBe('UNAUTHENTICATED');
    expectRussian(body.message ?? body.error, 'сообщение ошибки');
  });

  it('возвращает полный авторитетный снимок и закрытые состояния без процентов', async () => {
    const snapshot = await getWorkplace();
    const required = ['revision', 'serverTime', 'operator', 'assignments', 'equipment', 'shift', 'phase', 'phases',
      'workMode', 'readiness', 'actions', 'primaryAction', 'persistentActions', 'inspections', 'workZone', 'meter',
      'activeInterval', 'production', 'defects', 'incidents', 'report', 'handover', 'contacts', 'sync'];
    required.forEach((field) => expect(snapshot, `Нет обязательного поля ${field}`).toHaveProperty(field));

    expect(['string', 'number']).toContain(typeof snapshot.revision);
    expect(Number.isNaN(Date.parse(snapshot.serverTime))).toBe(false);
    expect(snapshot.operator).toMatchObject({id: expect.any(String), name: expect.any(String)});
    expectRussian(snapshot.operator.name, 'operator.name');
    expect(snapshot.assignments).toEqual(expect.any(Array));
    expect(snapshot.inspections).toEqual(expect.any(Array));
    expect(snapshot.defects).toEqual(expect.any(Array));
    expect(snapshot.incidents).toEqual(expect.any(Array));
    expect(WORK_MODES).toContain(snapshot.workMode);
    expect(READINESS_DECISIONS).toContain(snapshot.readiness.decision);
    expect(READINESS_FRESHNESS).toContain(snapshot.readiness.freshness);
    expect(SYNC_STATES).toContain(snapshot.sync.state);
    expectRussian(snapshot.phase.name, 'phase.name');
    expectRussian(snapshot.readiness.label ?? snapshot.readiness.decisionLabel, 'readiness.label');
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:score|percent|percentage)"\s*:/i);
  });

  it('возвращает ровно семь русских фаз', async () => {
    const snapshot = await getWorkplace();
    expect(snapshot.phases).toHaveLength(7);
    expect(snapshot.phases.map((phase: Json) => phase.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    snapshot.phases.forEach((phase: Json) => expectRussian(phase.name, `фаза ${phase.number}`));
  });

  it('не позволяет клиенту расширить область доступа или назначить себе этап', async () => {
    const authoritative = await getWorkplace();
    const forged = await getWorkplace('?phase=7&operatorId=чужой-оператор&tenantId=чужая-организация');
    for (const field of ['revision', 'operator', 'assignments', 'equipment', 'shift', 'phase', 'actions']) {
      expect(forged[field], `Клиент изменил авторитетное поле ${field}`).toEqual(authoritative[field]);
    }
    expect(JSON.stringify(forged)).not.toContain('чужой-оператор');
    expect(JSON.stringify(forged)).not.toContain('чужая-организация');
  });

  it('публикует только полные серверные действия и одно главное действие', async () => {
    const snapshot = await getWorkplace();
    expect(snapshot.actions).toEqual(expect.any(Array));
    for (const action of snapshot.actions) {
      expect(action).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        kind: expect.stringMatching(/^(COMMAND|SCREEN|NAVIGATION)$/),
        offlinePolicy: expect.stringMatching(/^(FORBIDDEN|CAPTURE_ONLY|AUTHORIZED)$/),
      });
      expect(action).toHaveProperty('requiresEvidence');
      expectRussian(action.label, `действие ${action.id}`);
      if (action.kind === 'COMMAND') {
        expect(action.method).toBe('POST');
        expect(action.route).toMatch(/^\/api\/operator\/v3\/(?:commands\/[^/]+|sync)$/);
        expect(Number.isInteger(action.expectedVersion)).toBe(true);
      }
    }
    if (snapshot.primaryAction !== null) {
      expect(snapshot.actions.find((action: Json) => action.id === snapshot.primaryAction.id)).toEqual(snapshot.primaryAction);
    }
    expect(snapshot.persistentActions).toEqual(expect.arrayContaining([
      expect.objectContaining({label: expect.stringMatching(/дефект/i)}),
      expect.objectContaining({label: expect.stringMatching(/опасн/i)}),
      expect.objectContaining({label: expect.stringMatching(/фотограф/i)}),
    ]));
  });

  it.skipIf(!statefulMutationEnabled)('однократно сохраняет команду и возвращает ту же деловую квитанцию при повторе', async () => {
    const before = await getWorkplace();
    const assignment = before.assignments[0];
    expect(assignment, 'Фикстура должна содержать доступное назначение').toBeTruthy();
    const action = before.actions.find((candidate: Json) => candidate.route === '/api/operator/v3/commands/accept-assignment');
    expect(action, 'Фикстура должна разрешать получение назначения').toMatchObject({method: 'POST', expectedVersion: expect.any(Number)});

    const commandId = `operator-v3-contract-${Date.now()}`;
    const envelope = {
      commandId,
      deviceId: 'operator-v3-contract-device',
      deviceSequence: 1,
      occurredAt: new Date().toISOString(),
      expectedVersion: action.expectedVersion,
      payload: {assignmentId: assignment.id},
    };
    const send = () => fetch(`${baseUrl}${action.route}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', cookie, 'idempotency-key': commandId},
      body: JSON.stringify(envelope),
    });

    const first = await readJson(await send());
    const replay = await readJson(await send());
    expect(first).toMatchObject({result: 'COMPLETED', replayed: false, commandId, newVersion: expect.any(Number), workplace: expect.any(Object)});
    expect(replay).toEqual({...first, replayed: true});

    const reread = await getWorkplace();
    expect(reread.revision).toBe(first.workplace.revision);
    expect(reread.assignments.find((item: Json) => item.id === assignment.id)).toEqual(
      first.workplace.assignments.find((item: Json) => item.id === assignment.id),
    );

    const eventEnvelope = await readJson(await fetch(
      `${baseUrl}/api/operator/v3/events?commandId=${encodeURIComponent(commandId)}`,
      {headers: {cookie}},
    ));
    expect(eventsFrom(eventEnvelope).filter((event) => event.commandId === commandId)).toHaveLength(1);
  });
});
