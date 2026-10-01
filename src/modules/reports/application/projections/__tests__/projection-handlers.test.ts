/**
 * projectWeeklyTrend — удалённый объект против невидимого под RLS.
 *
 * `findUnique` по Site возвращает null и когда объекта правда нет (ночной
 * набор автотестов удаляет отчёт, затем объект — F-PROJ-DELETED-SITE), и
 * когда объект есть, но скрыт строгой RLS без контекста организации. Первый
 * случай пересчитывать нечего и событие нельзя гнать в DLQ, второй — реальная
 * ошибка доставки. Различает их только контекст организации запроса.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { siteFindUniqueMock, dailySummariesMock, upsertMock, infoMock } = vi.hoisted(() => ({
  siteFindUniqueMock: vi.fn(),
  dailySummariesMock: vi.fn(),
  upsertMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    site: { findUnique: siteFindUniqueMock },
    siteDailySummary: { findMany: dailySummariesMock },
    siteWeeklyTrend: { upsert: upsertMock },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: infoMock, error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { projectWeeklyTrend } from '../projection-handlers';

/** Вызов обработчика внутри контекста запроса с выставленным тенантом. */
function withTenant(tenantId: string | null, fn: () => Promise<void>) {
  return runWithTenantContext(async () => {
    setRequestTenantId(tenantId);
    await fn();
  });
}

describe('projectWeeklyTrend — отсутствующий или невидимый объект', () => {
  beforeEach(() => {
    siteFindUniqueMock.mockReset();
    dailySummariesMock.mockReset();
    dailySummariesMock.mockResolvedValue([]);
    upsertMock.mockReset();
    infoMock.mockReset();
  });

  it('объекта нет, но контекст организации есть → выход без ошибки, upsert не вызван', async () => {
    siteFindUniqueMock.mockResolvedValue(null);

    await expect(withTenant('tenant-a', () => projectWeeklyTrend('site-gone'))).resolves.toBeUndefined();

    expect(infoMock).toHaveBeenCalledWith(
      'Объект удалён — недельная сводка не пересчитывается',
      { siteId: 'site-gone' }
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('объекта нет и контекста нет → ошибка (RLS могла скрыть существующий объект)', async () => {
    siteFindUniqueMock.mockResolvedValue(null);

    await expect(projectWeeklyTrend('site-hidden')).rejects.toThrow(
      'projectWeeklyTrend: site site-hidden not visible: no tenant context'
    );

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('объект найден, но tenantId пуст → ошибка, как раньше', async () => {
    siteFindUniqueMock.mockResolvedValue({ tenantId: null });

    await expect(withTenant('tenant-a', () => projectWeeklyTrend('site-no-tenant'))).rejects.toThrow(
      'projectWeeklyTrend: site site-no-tenant has no tenantId'
    );

    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('обычный случай → недельная строка пересчитана', async () => {
    siteFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-a' });
    dailySummariesMock.mockResolvedValue([
      { date: '2026-09-28', totalPiles: 3, totalDrilling: 0, totalDowntime: 0, reportCount: 1 },
      { date: '2026-09-29', totalPiles: 5, totalDrilling: 0, totalDowntime: 0, reportCount: 1 },
    ]);

    await withTenant('tenant-a', () => projectWeeklyTrend('site-1', '2026-09-29'));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId_weekStart: { siteId: 'site-1', weekStart: '2026-09-28' } },
        create: expect.objectContaining({ tenantId: 'tenant-a', totalPiles: 8, pilesTrend: 'UP' }),
      })
    );
  });
});
