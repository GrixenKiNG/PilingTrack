// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Решение владельца 18.10.2026: администратор может всё, что оператор, в режиме
  «Действую как → Оператор». Каждое его действие в этом режиме помечается в
  журнале: кто (реальный администратор) и что он исполнял (роль оператора).
*/
const {requireAuthMock, queryMock, auditMock, acknowledgeMock} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  queryMock: vi.fn(),
  auditMock: vi.fn(),
  acknowledgeMock: vi.fn(),
}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler, withMutation: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: requireAuthMock}));
vi.mock('@/services/weather/weather-client', () => ({getWeatherAt: vi.fn()}));
vi.mock('@/modules/audit', () => ({recordAuditEvent: auditMock}));
vi.mock('@/modules/operator-mobile', () => {
  class OperatorCommandError extends Error {
    constructor(public status: number, message: string, public details?: unknown) { super(message); }
  }
  const stub = vi.fn();
  return {
    OperatorCommandError,
    queryOperatorMobileState: queryMock,
    acknowledgeBriefing: acknowledgeMock,
    confirmPpe: stub, submitKnowledgeTest: stub, acceptEquipment: stub, submitChecklist: stub,
    logProduction: stub, correctProduction: stub, reportIncident: stub, finishWork: stub,
    submitReport: stub, closeShift: stub,
  };
});

import {GET} from '../state/route';
import {POST} from '../command/route';

type Handler = (request: NextRequest) => Promise<Response>;
const getState = () => (GET as unknown as Handler)(new NextRequest('http://localhost/api/operator/mobile/state'));
const postCommand = (body: unknown) => (POST as unknown as Handler)(new NextRequest(
  'http://localhost/api/operator/mobile/command',
  {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)},
));

const admin = {id: 'adm-1', name: 'Админ', email: 'a@example.test', role: 'ADMIN', tenantId: 'orion', actingAs: 'OPERATOR'};
const operator = {id: 'op-1', name: 'Машинист', email: 'o@example.test', role: 'OPERATOR', tenantId: 'orion', actingAs: null};
const mechanic = {id: 'mech-1', name: 'Механик', email: 'm@example.test', role: 'MECHANIC', tenantId: 'orion', actingAs: 'OPERATOR'};

beforeEach(() => {
  requireAuthMock.mockReset();
  queryMock.mockReset().mockResolvedValue({phase: 'IDENTITY'});
  acknowledgeMock.mockReset().mockResolvedValue({ok: true});
  auditMock.mockReset().mockResolvedValue(undefined);
});

describe('состояние места оператора', () => {
  it('администратор в режиме оператора получает 200 и состояние по своему id', async () => {
    requireAuthMock.mockResolvedValue({user: admin, error: null});

    const response = await getState();

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({operatorId: 'adm-1', actingAs: 'OPERATOR'}));
  });

  it('администратор без режима оператора по-прежнему 403', async () => {
    requireAuthMock.mockResolvedValue({user: {...admin, actingAs: null}, error: null});

    expect((await getState()).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('обычный оператор работает как раньше и без пометки замещения', async () => {
    requireAuthMock.mockResolvedValue({user: operator, error: null});

    const response = await getState();

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({operatorId: 'op-1', actingAs: null}));
  });

  it('не-администратор с замещением не получает доступа', async () => {
    requireAuthMock.mockResolvedValue({user: mechanic, error: null});

    expect((await getState()).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('администратор, замещающий другую роль, на экране оператора получает 403', async () => {
    requireAuthMock.mockResolvedValue({user: {...admin, actingAs: 'MECHANIC'}, error: null});

    expect((await getState()).status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('команда смены', () => {
  it('администратор в режиме оператора выполняет команду и оставляет след с реальным администратором', async () => {
    requireAuthMock.mockResolvedValue({user: admin, error: null});

    const response = await postCommand({command: 'acknowledge-briefing'});

    expect(response.status).toBe(200);
    expect(acknowledgeMock).toHaveBeenCalledWith({tenantId: 'orion', operatorId: 'adm-1', actingAs: 'OPERATOR'});
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'operator.acting-command',
      actorId: 'adm-1',
      tenantId: 'orion',
      metadata: expect.objectContaining({actingAs: 'OPERATOR', realRole: 'ADMIN', command: 'acknowledge-briefing'}),
    }));
  });

  it('обычный оператор: команда без пометки замещения', async () => {
    requireAuthMock.mockResolvedValue({user: operator, error: null});

    const response = await postCommand({command: 'acknowledge-briefing'});

    expect(response.status).toBe(200);
    expect(acknowledgeMock).toHaveBeenCalledWith({tenantId: 'orion', operatorId: 'op-1', actingAs: null});
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('не-администратор с замещением: 403, команда не выполняется и след не пишется', async () => {
    requireAuthMock.mockResolvedValue({user: mechanic, error: null});

    const response = await postCommand({command: 'acknowledge-briefing'});

    expect(response.status).toBe(403);
    expect(acknowledgeMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});
