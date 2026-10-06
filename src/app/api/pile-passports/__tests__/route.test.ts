/**
 * GET /api/pile-passports — behavioural test of F-R37-5.
 *
 * The screen header «Период забивки» must count the driving day by the tenant
 * zone (server process runs in UTC), exactly as the .xlsx export does. A pile
 * driven 26.09 at 00:30 MSK is 25.09 in UTC; without the zone the screen would
 * title that journal «25.09» while the rows under it and the file say «26.09».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requireAuthMock, assertCanMock, getSettingsMock, listPilePassportsMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  getSettingsMock: vi.fn(),
  listPilePassportsMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/modules/settings', () => ({ getSettings: getSettingsMock }));
// Keep the real pileJournalHeader (the function under test) and stub only the query.
vi.mock('@/modules/reports/application/queries/pile-passport.service', async () => {
  const actual = await vi.importActual<object>('@/modules/reports/application/queries/pile-passport.service');
  return { ...actual, listPilePassports: listPilePassportsMock };
});

import { GET } from '../route';
import { can } from '@/services/auth/authorization-service';
import { ServiceError } from '@/lib/service-error';

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/pile-passports?${qs}`);
}

/** Строка выработки: только поля, которые читает pileJournalHeader (запрос заглушён). */
const row = (drivenAt: string) => ({
  drivenAt,
  siteName: 'Объект А',
  equipmentName: 'Копёр-1',
  hammerType: 'Дизель',
  hammerEnergyKj: 40,
  designRefusalMm: 2,
  acceptance: 'PENDING',
  count: 1,
  suggestion: null,
});

/** Итоги периода — титул берёт счётчики отсюда, не из показанных строк (W21). */
const totals = {
  piles: 1,
  draftPiles: 0,
  withoutPassportPiles: 1,
  accepted: 0,
  needsRedrive: 0,
  pending: 1,
  rows: 1,
};

describe('GET /api/pile-passports — период в поясе тенанта', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow' });
    listPilePassportsMock.mockResolvedValue({ rows: [], truncated: false, totals });
  });

  it('дату забивки 25.09 21:30 UTC печатает как 26.09.2026 по Москве, а не UTC-днём', async () => {
    listPilePassportsMock.mockResolvedValue({
      rows: [row('2026-09-25T21:30:00.000Z')],
      truncated: false,
      totals,
    });

    const response = await GET(req());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.header.dateFrom).toBe('26.09.2026');
    expect(body.header.dateTo).toBe('26.09.2026');
  });

  it('берёт пояс организации (getSettings), а не пояс процесса', async () => {
    getSettingsMock.mockResolvedValue({ timezone: 'Asia/Vladivostok' });
    // 25.09 14:30 UTC — это 25.09 17:30 МСК, но уже 26.09 00:30 во Владивостоке.
    listPilePassportsMock.mockResolvedValue({
      rows: [row('2026-09-25T14:30:00.000Z')],
      truncated: false,
      totals,
    });

    const response = await GET(req());
    const body = await response.json();

    expect(getSettingsMock).toHaveBeenCalledWith('tenant-a');
    expect(body.header.dateFrom).toBe('26.09.2026');
    expect(body.header.dateTo).toBe('26.09.2026');
  });
});

/**
 * Права и организация (W25, W31).
 *
 * Маршрут обязан проверять `piles.manage` ДО чтения данных и брать
 * организацию из сессии, а не из query. Тесты закрепляют это на уровне
 * поведения: без права сервис журнала не вызывается вовсе, а роль из query
 * не подменяет тенант пользователя. `assertCan` здесь считает право по
 * настоящей матрице (`can`), а не заглушкой-пустышкой.
 */
describe('GET /api/pile-passports — права и организация', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow' });
    listPilePassportsMock.mockResolvedValue({ rows: [], truncated: false, totals });
    assertCanMock.mockImplementation((user: { role: string; actingAs?: string | null }, ability: string) => {
      if (!can(user, ability as Parameters<typeof can>[1])) {
        throw new ServiceError('Доступ запрещён', 403);
      }
    });
  });

  it.each(['OPERATOR', 'ASSISTANT', 'MECHANIC'])(
    'роль %s без права piles.manage → 403, журнал не читается',
    async (role) => {
      requireAuthMock.mockResolvedValue({ user: { id: `${role}-1`, role, tenantId: 'tenant-a' }, error: null });

      const response = await GET(req());

      expect(response.status).toBe(403);
      expect(listPilePassportsMock).not.toHaveBeenCalled();
      expect(getSettingsMock).not.toHaveBeenCalled();
    },
  );

  it('нет сессии → 401, журнал не читается', async () => {
    requireAuthMock.mockResolvedValue({
      user: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(req());

    expect(response.status).toBe(401);
    expect(listPilePassportsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', 'admin-a'],
    ['DISPATCHER', 'disp-a'],
  ])('роль %s с правом piles.manage → 200', async (role, id) => {
    requireAuthMock.mockResolvedValue({ user: { id, role, tenantId: 'tenant-a' }, error: null });

    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(listPilePassportsMock).toHaveBeenCalledTimes(1);
  });

  it('в сервис уходит организация сессии, а tenantId из query игнорируется', async () => {
    const response = await GET(req('tenantId=tenant-b'));

    expect(response.status).toBe(200);
    expect(listPilePassportsMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(getSettingsMock).toHaveBeenCalledWith('tenant-a');
  });
});
