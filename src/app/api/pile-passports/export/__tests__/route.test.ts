/**
 * GET /api/pile-passports/export — ограничение частоты выгрузки (W30, аудит W25
 * находка 1).
 *
 * До 20000 строк .xlsx собирается в памяти целиком на каждый запрос, а право
 * `piles.manage` есть у трёх ролей: цикл выгрузок занимает процесс на всех.
 * Лимит — на пользователя (как у PDF-выгрузок), не на адрес: экраны бьют с
 * одного IP за NAT. Превышение — 429 и русский текст, без сборки файла.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireAuthMock, assertCanMock, exportMock, rateCheckMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  exportMock: vi.fn(),
  rateCheckMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: rateCheckMock },
  getRateLimitIdentifier: vi.fn(),
}));
vi.mock('@/modules/reports/application/queries/pile-passport.service', () => ({
  exportPileJournalXlsx: exportMock,
}));

import { GET } from '../route';
import { can } from '@/services/auth/authorization-service';
import { ServiceError } from '@/lib/service-error';

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/pile-passports/export?${qs}`);
}

describe('GET /api/pile-passports/export — ограничение частоты (W30)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    rateCheckMock.mockResolvedValue({ allowed: true, remaining: 5 });
    exportMock.mockResolvedValue(Buffer.from('xlsx'));
  });

  it('обычный запрос отдаёт файл (200)', async () => {
    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(exportMock).toHaveBeenCalledTimes(1);
  });

  it('превышение лимита → 429 с русским текстом, без сборки файла', async () => {
    rateCheckMock.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 42 });

    const response = await GET(req());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe('Слишком много выгрузок. Подождите минуту.');
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(exportMock).not.toHaveBeenCalled();
  });

  it('лимит ключуется пользователем: 6 выгрузок в минуту', async () => {
    await GET(req());

    expect(rateCheckMock).toHaveBeenCalledWith(
      'pile-export:get:admin-a',
      expect.objectContaining({ maxAttempts: 6, windowMs: 60_000 }),
    );
  });
});

/**
 * Права и организация (W25, W31). Выгрузка — тот же документ по сваям, и
 * право у неё `piles.manage`; организация берётся из сессии, не из query.
 * `assertCan` считает по настоящей матрице (`can`).
 */
describe('GET /api/pile-passports/export — права и организация', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    rateCheckMock.mockResolvedValue({ allowed: true, remaining: 5 });
    exportMock.mockResolvedValue(Buffer.from('xlsx'));
    assertCanMock.mockImplementation((user: { role: string; actingAs?: string | null }, ability: string) => {
      if (!can(user, ability as Parameters<typeof can>[1])) {
        throw new ServiceError('Доступ запрещён', 403);
      }
    });
  });

  it.each(['OPERATOR', 'ASSISTANT', 'MECHANIC'])(
    'роль %s без права piles.manage → 403, файл не собирается',
    async (role) => {
      requireAuthMock.mockResolvedValue({ user: { id: `${role}-1`, role, tenantId: 'tenant-a' }, error: null });

      const response = await GET(req());

      expect(response.status).toBe(403);
      expect(exportMock).not.toHaveBeenCalled();
    },
  );

  it('нет сессии → 401, файл не собирается', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(req());

    expect(response.status).toBe(401);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', 'admin-a'],
    ['DISPATCHER', 'disp-a'],
  ])('роль %s с правом piles.manage → 200', async (role, id) => {
    requireAuthMock.mockResolvedValue({ user: { id, role, tenantId: 'tenant-a' }, error: null });

    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(exportMock).toHaveBeenCalledTimes(1);
  });

  it('в выгрузку уходит организация сессии, а tenantId из query игнорируется', async () => {
    const response = await GET(req('tenantId=tenant-b'));

    expect(response.status).toBe(200);
    expect(exportMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
  });
});
