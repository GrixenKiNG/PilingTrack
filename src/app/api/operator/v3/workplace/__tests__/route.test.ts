import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest, NextResponse} from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  queryOperatorWorkplace: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({requireAuth: mocks.requireAuth}));
vi.mock('@/modules/operator-v3', () => ({
  queryOperatorWorkplace: mocks.queryOperatorWorkplace,
}));

import {GET} from '../route';

const workplace = {
  revision: 'revision-1',
  serverTime: '2026-08-26T05:00:00.000Z',
  operator: {id: 'operator-1', name: 'Иванов И.И.', blockers: [], warnings: []},
};

describe('GET /api/operator/v3/workplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: 'operator-1',
        name: 'Иванов И.И.',
        role: 'OPERATOR',
        tenantId: 'tenant-a',
      },
      error: null,
    });
    mocks.queryOperatorWorkplace.mockResolvedValue(workplace);
  });

  it('передаёт в запрос рабочего места только область настоящего сеанса', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/operator/v3/workplace?phase=7&operatorId=other&tenantId=tenant-b',
    ));

    expect(response.status).toBe(200);
    expect(mocks.queryOperatorWorkplace).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      operatorId: 'operator-1',
      operatorName: 'Иванов И.И.',
    });
    await expect(response.json()).resolves.toEqual({data: workplace});
  });

  it('возвращает договорную русскую ошибку без сеанса', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: null,
      error: NextResponse.json({error: 'Authentication required'}, {status: 401}),
    });

    const response = await GET(new NextRequest('http://localhost/api/operator/v3/workplace'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Войдите в систему, чтобы открыть рабочее место оператора',
    });
    expect(mocks.queryOperatorWorkplace).not.toHaveBeenCalled();
  });

  it('запрещает доступ пользователю без роли оператора', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: {id: 'admin-1', name: 'Администратор', role: 'ADMIN', tenantId: 'tenant-a'},
      error: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/operator/v3/workplace'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringMatching(/[А-Яа-яЁё]/),
    });
    expect(mocks.queryOperatorWorkplace).not.toHaveBeenCalled();
  });

  it('не использует резервную организацию при отсутствии tenantId в сеансе', async () => {
    mocks.requireAuth.mockResolvedValue({
      user: {id: 'operator-1', name: 'Иванов И.И.', role: 'OPERATOR', tenantId: null},
      error: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/operator/v3/workplace?tenantId=tenant-b'));

    expect(response.status).toBe(403);
    expect(mocks.queryOperatorWorkplace).not.toHaveBeenCalled();
  });
});
