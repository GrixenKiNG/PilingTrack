// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const {logProductionMock, requireAuthMock} = vi.hoisted(() => ({
  logProductionMock: vi.fn(),
  requireAuthMock: vi.fn(),
}));

vi.mock('@/core/api-wrapper', () => ({withMutation: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: requireAuthMock}));
vi.mock('@/services/weather/weather-client', () => ({getWeatherAt: vi.fn()}));
vi.mock('@/modules/operator-mobile', () => {
  class OperatorCommandError extends Error {
    constructor(public status: number, message: string, public details?: unknown) { super(message); }
  }
  const stub = vi.fn();
  return {
    OperatorCommandError,
    logProduction: logProductionMock,
    acceptEquipment: stub, acknowledgeBriefing: stub, closeShift: stub, confirmPpe: stub, finishWork: stub,
    submitReport: stub, correctProduction: stub, reportIncident: stub, submitChecklist: stub, submitKnowledgeTest: stub,
  };
});

import {POST} from '../route';

const post = (entry: Record<string, unknown>) => (POST as unknown as (request: NextRequest) => Promise<Response>)(
  new NextRequest('http://localhost/api/operator/mobile/command', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      command: 'log-production', clientCommandId: 'cmd-12345678', shiftId: 'shift-1', entry,
    }),
  }),
);

// Решение владельца 07.10.2026: простой с экрана машиниста — часы, без привязки
// ко времени. Старая форма (начало и конец) остаётся для очереди офлайна.
describe('log-production: простой', () => {
  beforeEach(() => {
    logProductionMock.mockReset().mockResolvedValue({reportId: 'RM-1'});
    requireAuthMock.mockReset().mockResolvedValue({user: {id: 'op-1', role: 'OPERATOR', tenantId: 'orion'}});
  });

  it('принимает часы без начала и конца', async () => {
    const response = await post({kind: 'DOWNTIME', reasonId: 'r1', hours: 1.5});

    expect(response.status).toBe(200);
    expect(logProductionMock).toHaveBeenCalledWith(expect.objectContaining({
      entry: expect.objectContaining({kind: 'DOWNTIME', hours: 1.5}),
    }));
  });

  it('принимает прежний интервал — запись из очереди офлайна дойдёт', async () => {
    const response = await post({
      kind: 'DOWNTIME', reasonId: 'r1',
      startedAt: '2026-10-06T08:00:00.000Z', endedAt: '2026-10-06T09:00:00.000Z',
    });

    expect(response.status).toBe(200);
  });

  it('без часов и без интервала — 400', async () => {
    const response = await post({kind: 'DOWNTIME', reasonId: 'r1'});

    expect(response.status).toBe(400);
    expect(logProductionMock).not.toHaveBeenCalled();
  });

  it('только начало без конца — 400', async () => {
    const response = await post({kind: 'DOWNTIME', reasonId: 'r1', startedAt: '2026-10-06T08:00:00.000Z'});

    expect(response.status).toBe(400);
  });

  it.each([0.1, 0, -1, 25])('часы %s — 400 на уровне формы', async (hours) => {
    const response = await post({kind: 'DOWNTIME', reasonId: 'r1', hours});

    expect(response.status).toBe(400);
  });
});
