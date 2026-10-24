/**
 * POST /api/pile-passports/[id]/decide — граница API решения мастера по свае.
 *
 * Прежнее решение (F-R34-16) и след `pile.passport.decided` читает и пишет сама
 * команда `decidePilePassport` в одной транзакции с решением (проверяется в
 * pile-passport.service.test.ts). Маршрут проверяет данные и передаёт команде
 * организацию и актора.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assertCanMock, decideMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    assertCanMock: vi.fn(),
    decideMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/modules/reports/application/queries/pile-passport.service', () => ({
  decidePilePassport: decideMock,
}));

import { POST } from '../route';
import { ServiceError } from '@/lib/service-error';

const foreman = { id: 'foreman-1', role: 'ADMIN', tenantId: 'tenant-a' };

const params = Promise.resolve({ id: 'p-1' });

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pile-passports/p-1/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: foreman, error: null });
  decideMock.mockResolvedValue(undefined);
});

describe('POST /api/pile-passports/[id]/decide', () => {
  it('передаёт команде организацию, актора и решение; основание команда обрезает сама', async () => {
    const response = await POST(
      req({ acceptance: 'NEEDS_REDRIVE', note: '  Не добита до проектного отказа  ' }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(decideMock).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      passportId: 'p-1',
      actorId: 'foreman-1',
      acceptance: 'NEEDS_REDRIVE',
      note: '  Не добита до проектного отказа  ',
    });
  });

  it('чужой или несуществующий паспорт: 404 из команды', async () => {
    decideMock.mockRejectedValue(new ServiceError('Паспорт сваи не найден', 404));

    const response = await POST(req({ acceptance: 'ACCEPTED' }), { params });

    expect(response.status).toBe(404);
  });

  it('отклонённые данные до команды не доходят', async () => {
    const response = await POST(req({ acceptance: 'PENDING' }), { params });

    expect(response.status).toBe(400);
    expect(decideMock).not.toHaveBeenCalled();
  });
});

describe('D4: основание добивки на границе API', () => {
  it.each([undefined, '', ' \t\n '])('отклоняет пустое основание %j до обращения к БД', async (note) => {
    const response = await POST(req({ acceptance: 'NEEDS_REDRIVE', note }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Укажите, почему свая идёт на добивку');
    expect(decideMock).not.toHaveBeenCalled();
  });
});
