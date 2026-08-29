// @vitest-environment node

import {beforeAll, describe, expect, it} from 'vitest';

const baseUrl = process.env.OPERATOR_V3_TEST_BASE_URL ?? 'http://localhost:3000';
const statefulMutationEnabled = process.env.OPERATOR_V3_STATEFUL_PREFLIGHT === 'true';
let cookie = '';

type Json = Record<string, any>;

async function json(response: Response): Promise<Json> {
  const text = await response.text();
  expect(response.status, `${response.url}: ${text}`).toBe(200);
  return JSON.parse(text) as Json;
}

async function workplace(query = ''): Promise<Json> {
  const body = await json(await fetch(`${baseUrl}/api/operator/v3/workplace${query}`, {
    headers: {cookie},
  }));
  return body.data ?? body['данные'] ?? body;
}

function expectRussian(value: unknown): void {
  expect(String(value)).toMatch(/[А-Яа-яЁё]/);
}

describe.sequential('рабочее место оператора v3 — первый вертикальный срез', () => {
  beforeAll(async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: 'operator@piling.ru', password: process.env.OPERATOR_PASSWORD ?? 'operator123'}),
    });
    expect(response.status, 'Нужен настоящий сеанс оператора').toBe(200);
    cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    expect(cookie).not.toBe('');
  });

  it('возвращает авторитетный русский снимок без балла и процента готовности', async () => {
    const snapshot = await workplace();
    expect(snapshot).toMatchObject({
      revision: expect.anything(),
      serverTime: expect.any(String),
      operator: expect.any(Object),
      readiness: expect.any(Object),
      actions: expect.any(Array),
    });
    expectRussian(snapshot.phase?.name ?? snapshot.phase?.label);
    expectRussian(snapshot.readiness?.label ?? snapshot.readiness?.decisionLabel);
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:score|percent|percentage)"\s*:/i);
  });

  it('возвращает все семь фаз с русскими названиями', async () => {
    const {phases} = await workplace();
    expect(phases).toHaveLength(7);
    expect(phases.map((phase: Json) => phase.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    phases.forEach((phase: Json) => expectRussian(phase.name ?? phase.label));
  });

  it('возвращает одно главное и постоянные действия, определённые сервером', async () => {
    const snapshot = await workplace();
    expect(snapshot).toHaveProperty('primaryAction');
    expect(snapshot.persistentActions).toEqual(expect.arrayContaining([
      expect.objectContaining({label: expect.stringMatching(/дефект/i)}),
      expect.objectContaining({label: expect.stringMatching(/опасн/i)}),
      expect.objectContaining({label: expect.stringMatching(/фотограф/i)}),
    ]));
    if (snapshot.primaryAction) {
      expect(snapshot.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({id: snapshot.primaryAction.id}),
      ]));
      expectRussian(snapshot.primaryAction.label);
    }
  });

  it('игнорирует предложенный клиентом этап и идентификаторы области доступа', async () => {
    const authoritative = await workplace();
    const forged = await workplace('?phase=7&operatorId=чужой-оператор&tenantId=чужая-организация');
    expect(forged.phase).toEqual(authoritative.phase);
    expect(forged.revision).toBe(authoritative.revision);
    expect(forged.operator?.id).toBe(authoritative.operator?.id);
  });

  it.skipIf(!statefulMutationEnabled)('возвращает одну деловую квитанцию при первом выполнении и повторе команды', async () => {
    const snapshot = await workplace();
    const assignmentId = snapshot.assignments?.[0]?.id;
    expect(assignmentId, 'Испытательная фикстура должна содержать назначение оператора').toBeTruthy();
    const commandId = `operator-v3-accept-${Date.now()}`;
    const envelope = {
      commandId,
      deviceId: 'operator-v3-test-device',
      deviceSequence: 1,
      occurredAt: new Date().toISOString(),
      expectedVersion: snapshot.shift?.version ?? snapshot.primaryAction?.expectedVersion ?? 0,
      payload: {assignmentId},
    };
    const send = () => fetch(`${baseUrl}/api/operator/v3/commands/accept-assignment`, {
      method: 'POST',
      headers: {'content-type': 'application/json', cookie, 'idempotency-key': commandId},
      body: JSON.stringify(envelope),
    });
    const first = await json(await send());
    const replay = await json(await send());
    expect(first).toMatchObject({result: 'COMPLETED', replayed: false, commandId, newVersion: expect.any(Number)});
    expect(replay).toMatchObject({result: 'COMPLETED', replayed: true, commandId, newVersion: first.newVersion});
    expect(replay.workplace).toEqual(first.workplace);
  });
});
