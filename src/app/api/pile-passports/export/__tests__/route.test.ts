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
import { NextRequest } from 'next/server';

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

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function req(): NextRequest {
  return new NextRequest('http://localhost/api/pile-passports/export');
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
