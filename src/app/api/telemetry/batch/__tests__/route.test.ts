// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest, NextResponse} from 'next/server';

/*
  Пакетный приём телеметрии (вход с сессией пользователя).

  Держится, по порядку проверок:
  1. CSRF и частота (ключ с префиксом телеметрии, чтобы не делить корзину с
     публичной формой заявок);
  2. сессия и роль: телеметрию подают только ADMIN, DISPATCHER и OPERATOR;
  3. защита базы: при открытом предохранителе ничего не читается и не пишется;
  4. форма: массив до 100 записей, схема записи;
  5. ГРАНИЦА ОРГАНИЗАЦИИ: техника из тела запроса должна принадлежать организации
     сессии, иначе 403 и ни одной записи (у телеметрии своей колонки организации
     нет — якорь организации это установка);
  6. в приём уходит организация сессии, а не присланная в теле.
*/
const h = vi.hoisted(() => ({
  FakeCircuitOpenError: class FakeCircuitOpenError extends Error {
    retryAfterMs: number;
    constructor(retryAfterMs: number) { super('open'); this.retryAfterMs = retryAfterMs; }
  },
  withCsrf: vi.fn(),
  check: vi.fn(),
  requireAuth: vi.fn(),
  breakerStats: vi.fn(),
  ingestTelemetryBatch: vi.fn(),
  findForeignEquipmentIds: vi.fn(),
  bufferStats: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/core/api-wrapper', async () => {
  const {ServiceError} = await import('@/lib/service-error');
  return {
    withApi: (handler: unknown) => handler,
    readJsonBody: async (request: NextRequest) => {
      try { return await request.json(); } catch { throw new ServiceError('Тело запроса должно быть корректным JSON', 400); }
    },
  };
});
vi.mock('@/lib/csrf-protection', () => ({withCsrf: h.withCsrf}));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: {check: h.check},
  getRateLimitIdentifier: () => 'ip:1.2.3.4',
}));
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/lib/logger', () => ({logger: {warn: h.loggerWarn, error: vi.fn(), info: vi.fn()}}));
vi.mock('@/core/infrastructure/circuit-breakers', () => ({
  databaseCircuitBreaker: {getStats: h.breakerStats},
  CircuitOpenError: h.FakeCircuitOpenError,
}));
vi.mock('@/modules/telemetry', () => ({
  ingestTelemetryBatch: h.ingestTelemetryBatch,
  findForeignEquipmentIds: h.findForeignEquipmentIds,
  telemetryBuffer: {getStats: h.bufferStats},
}));

import {POST} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (body: unknown, raw = false) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/telemetry/batch', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: raw ? String(body) : JSON.stringify(body),
}));
const record = (overrides: Record<string, unknown> = {}) => ({type: 'fuel', equipmentId: 'eq-1', value: 42, ...overrides});

const OPERATOR = {id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-a'};

beforeEach(() => {
  vi.clearAllMocks();
  h.withCsrf.mockReturnValue(null);
  h.check.mockResolvedValue({allowed: true});
  h.requireAuth.mockResolvedValue({user: OPERATOR, error: null});
  h.breakerStats.mockReturnValue({state: 'CLOSED'});
  h.findForeignEquipmentIds.mockResolvedValue([]);
  h.ingestTelemetryBatch.mockResolvedValue(2);
  h.bufferStats.mockReturnValue({size: 5});
});

describe('POST /api/telemetry/batch — вход', () => {
  it('отказ CSRF возвращается как есть, дальше ничего не проверяется', async () => {
    h.withCsrf.mockReturnValue(NextResponse.json({error: 'csrf'}, {status: 403}));

    expect((await post([record()])).status).toBe(403);
    expect(h.check).not.toHaveBeenCalled();
    expect(h.requireAuth).not.toHaveBeenCalled();
  });

  it('частота: ключ с префиксом телеметрии, сверх лимита — 429 с Retry-After, без проверки сессии', async () => {
    h.check.mockResolvedValue({allowed: false, retryAfter: 45});

    const response = await post([record()]);

    expect(h.check.mock.calls[0][0]).toBe('telemetry:ip:1.2.3.4');
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(h.requireAuth).not.toHaveBeenCalled();
  });

  it('без сессии приём не вызывается', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await post([record()])).status).toBe(401);
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });

  it.each(['ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER'])('роль %s телеметрию не подаёт', async (role) => {
    h.requireAuth.mockResolvedValue({user: {...OPERATOR, role}, error: null});

    expect((await post([record()])).status).toBe(403);
    expect(h.findForeignEquipmentIds).not.toHaveBeenCalled();
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('предохранитель базы открыт: 503 с Retry-After, тело не разбирается', async () => {
    h.breakerStats.mockReturnValue({state: 'OPEN', timeUntilRetry: 12_300, failures: 5, failureThreshold: 5});

    const response = await post([record()]);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('13');
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });
});

describe('POST /api/telemetry/batch — форма', () => {
  it('не массив: 400', async () => {
    expect((await post({equipmentId: 'eq-1'})).status).toBe(400);
  });

  it('больше 100 записей: 400 с пределом, приём не вызывается', async () => {
    const response = await post(Array.from({length: 101}, () => record()));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({maxBatchSize: 100, receivedCount: 101});
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('ровно 100 записей принимаются', async () => {
    expect((await post(Array.from({length: 100}, () => record()))).status).toBe(200);
  });

  it.each([
    ['нет значения', {type: 'fuel', equipmentId: 'eq-1'}],
    ['значение не число', record({value: '42'})],
    ['пустая техника', record({equipmentId: ''})],
    ['слишком длинный тип', record({type: 'x'.repeat(51)})],
    ['время не ISO', record({timestamp: 'вчера'})],
  ])('%s: 400, проверка принадлежности и приём не вызываются', async (_name, bad) => {
    const response = await post([bad]);

    expect(response.status).toBe(400);
    expect(h.findForeignEquipmentIds).not.toHaveBeenCalled();
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('тело не JSON: отказ от разбора тела', async () => {
    await expect(post('{не json', true)).rejects.toMatchObject({status: 400});
  });
});

describe('POST /api/telemetry/batch — граница организации и приём', () => {
  it('чужая техника: 403 и ни одной записи, даже если часть своя', async () => {
    h.findForeignEquipmentIds.mockResolvedValue(['eq-foreign']);

    const response = await post([record(), record({equipmentId: 'eq-foreign'})]);

    expect(response.status).toBe(403);
    expect(h.findForeignEquipmentIds).toHaveBeenCalledWith('tenant-a', ['eq-1', 'eq-foreign']);
    expect(h.ingestTelemetryBatch).not.toHaveBeenCalled();
  });

  it('проверка идёт по уникальным установкам, а не по числу записей', async () => {
    await post([record(), record({value: 1}), record({value: 2})]);

    expect(h.findForeignEquipmentIds).toHaveBeenCalledWith('tenant-a', ['eq-1']);
  });

  it('пользователь без организации получает отказ до проверки техники', async () => {
    h.requireAuth.mockResolvedValue({user: {...OPERATOR, tenantId: null}, error: null});

    await expect(post([record()])).rejects.toMatchObject({status: 403});
    expect(h.findForeignEquipmentIds).not.toHaveBeenCalled();
  });

  it('в приём уходит организация сессии, присланная в теле отбрасывается схемой; null становится «нет»', async () => {
    await post([record({tenantId: 'tenant-evil', siteId: null, unit: null, latitude: null, timestamp: '2026-10-26T09:00:00.000Z'})]);

    const [records] = h.ingestTelemetryBatch.mock.calls[0];
    expect(records[0]).toMatchObject({tenantId: 'tenant-a', equipmentId: 'eq-1', value: 42});
    expect(records[0].siteId).toBeUndefined();
    expect(records[0].unit).toBeUndefined();
    expect(records[0].latitude).toBeUndefined();
    expect(records[0].timestamp).toEqual(new Date('2026-10-26T09:00:00.000Z'));
  });

  it('ответ показывает, сколько принято и сколько отсеяно выборкой', async () => {
    const response = await post([record(), record(), record(), record()]);

    expect(await response.json()).toEqual({success: true, ingested: 2, sampled: 2, buffer: {size: 5}});
  });

  it('предохранитель сработал во время приёма: 503 с Retry-After, не 500', async () => {
    h.ingestTelemetryBatch.mockRejectedValue(new h.FakeCircuitOpenError(7_100));
    h.breakerStats.mockReturnValue({state: 'CLOSED'});

    const response = await post([record()]);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('8');
    expect(h.loggerWarn).toHaveBeenCalled();
  });

  it('любая другая ошибка приёма пробрасывается: запись не объявляется принятой', async () => {
    h.ingestTelemetryBatch.mockRejectedValue(new Error('сбой записи'));

    await expect(post([record()])).rejects.toThrow('сбой записи');
  });
});
