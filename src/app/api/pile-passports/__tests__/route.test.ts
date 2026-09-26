/**
 * GET /api/pile-passports — behavioural test of F-R37-5.
 *
 * The screen header «Период забивки» must count the driving day by the tenant
 * zone (server process runs in UTC), exactly as the .xlsx export does. A pile
 * driven 26.09 at 00:30 MSK is 25.09 in UTC; without the zone the screen would
 * title that journal «25.09» while the rows under it and the file say «26.09».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/pile-passports?${qs}`);
}

/** Only the fields pileJournalHeader reads; the query itself is stubbed. */
const row = (drivenAt: string) => ({
  drivenAt,
  siteName: 'Объект А',
  equipmentName: 'Копёр-1',
  hammerType: 'Дизель',
  hammerEnergyKj: 40,
  designRefusalMm: 2,
  acceptance: 'PENDING',
  suggestion: null,
});

describe('GET /api/pile-passports — период в поясе тенанта', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow' });
    listPilePassportsMock.mockResolvedValue({ rows: [], truncated: false });
  });

  it('дату забивки 25.09 21:30 UTC печатает как 26.09.2026 по Москве, а не UTC-днём', async () => {
    listPilePassportsMock.mockResolvedValue({
      rows: [row('2026-09-25T21:30:00.000Z')],
      truncated: false,
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
    });

    const response = await GET(req());
    const body = await response.json();

    expect(getSettingsMock).toHaveBeenCalledWith('tenant-a');
    expect(body.header.dateFrom).toBe('26.09.2026');
    expect(body.header.dateTo).toBe('26.09.2026');
  });
});
