// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Рабочее место помощника при недоступной базе: то же правило, что у машиниста
  (аудит 16.10.2026, P2 D-20261016-002).
*/
const {requireAuthMock} = vi.hoisted(() => ({requireAuthMock: vi.fn()}));

vi.mock('@/core/api-wrapper', () => ({withApi: (handler: unknown) => handler, withMutation: (handler: unknown) => handler}));
vi.mock('@/lib/auth', () => ({requireAuth: requireAuthMock}));
vi.mock('@/lib/tenant', () => ({requireTenantId: () => 'orion'}));
vi.mock('@/modules/operator-mobile', () => ({
  queryAssistantState: vi.fn(),
  acknowledgeBriefing: vi.fn(),
  submitKnowledgeTest: vi.fn(),
  OperatorCommandError: class extends Error {},
}));

import {GET} from '../state/route';
import {POST} from '../command/route';

type Handler = (request: NextRequest) => Promise<Response>;
const getState = () => (GET as unknown as Handler)(new NextRequest('http://localhost/api/assistant/state'));
const postCommand = () => (POST as unknown as Handler)(new NextRequest('http://localhost/api/assistant/command', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: '{}',
}));

beforeEach(() => requireAuthMock.mockReset());

describe.each([['состояние', getState], ['команда', postCommand]] as const)('помощник: %s', (_name, call) => {
  it('сбой проверки сессии (500) — 503 «временно недоступен», а не просьба войти', async () => {
    requireAuthMock.mockResolvedValue({user: null, error: new Response('{}', {status: 500})});

    const response = await call();

    expect(response.status).toBe(503);
    expect(((await response.json()) as {error: string}).error).not.toMatch(/войдите/i);
  });

  it('нет сессии (401) — по-прежнему «Войдите в систему»', async () => {
    requireAuthMock.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    const response = await call();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({error: 'Войдите в систему'});
  });
});
