import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheAside: vi.fn(),
  invalidate: vi.fn(),
  patternInvalidate: vi.fn(),
  recordDeletion: vi.fn(),
  pileGradeFindMany: vi.fn(),
  drillingTypeFindMany: vi.fn(),
  downtimeReasonFindMany: vi.fn(),
}));

vi.mock('@/lib/cache-strategies', () => ({
  cacheAside: mocks.cacheAside,
  cacheAsideInvalidate: mocks.invalidate,
  writeThrough: vi.fn(),
}));
vi.mock('@/lib/redis-cache', () => ({
  cache: { invalidatePattern: mocks.patternInvalidate },
}));
vi.mock('@/lib/cache-metrics', () => ({ recordDeletion: mocks.recordDeletion }));
vi.mock('@/lib/db', () => ({
  db: {
    pileGrade: { findMany: mocks.pileGradeFindMany },
    drillingType: { findMany: mocks.drillingTypeFindMany },
    downtimeReason: { findMany: mocks.downtimeReasonFindMany },
  },
}));

import { getCachedAllDictionaries, invalidateDictionaries, invalidateSiteAnalytics } from '../cached-queries';

describe('tenant dictionary cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheAside.mockImplementation(async (_key: string, compute: () => Promise<unknown>) => compute());
    mocks.pileGradeFindMany.mockResolvedValue([]);
    mocks.drillingTypeFindMany.mockResolvedValue([]);
    mocks.downtimeReasonFindMany.mockResolvedValue([]);
  });

  it('uses a separate cache key and query scope for each tenant', async () => {
    await getCachedAllDictionaries('tenant-a');

    expect(mocks.cacheAside).toHaveBeenCalledWith(
      'dictionary:tenant-a:all', expect.any(Function), expect.any(Object)
    );
    expect(mocks.pileGradeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a' },
    }));
  });

  it('returns archived items too, so an old report can resolve its grade (F-R29-2)', async () => {
    const archived = { id: 'g-arch', name: 'СВ 300-80', isActive: false, lengthMm: 12000 };
    const active = { id: 'g-act', name: 'СВ 350-100', isActive: true, lengthMm: 15000 };
    mocks.pileGradeFindMany.mockResolvedValue([active, archived]);

    const result = await getCachedAllDictionaries('tenant-a');

    // Архивная марка обязана доехать до формы: по ней резолвится строка уже
    // сданного отчёта (иначе — сырой cuid и 0 м.п.). Выбор её прячут списки.
    expect(result.pileGrades).toEqual([active, archived]);
    // Фильтр по активности теперь только у потребителя — здесь его нет.
    expect(mocks.pileGradeFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a', isActive: true } }),
    );
  });

  it('invalidates only the selected tenant key', async () => {
    await invalidateDictionaries('tenant-a');

    expect(mocks.invalidate).toHaveBeenCalledWith('dictionary:tenant-a:all');
    expect(mocks.invalidate).not.toHaveBeenCalledWith('dictionary:tenant-b:all');
  });
});

describe('site analytics cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
    Сводка по объектам лежит в Redis под ключом `analytics:sites:v3:${tenantId}:…`
    и не сбрасывалась ни одной мутацией отчёта: дашборд до 5 минут показывал
    прежнюю выработку (F-R35-2). Снимаем ключи по префиксу с организацией —
    все срезы (периоды/объекты) своей организации, ни одного чужого.
  */
  it('сбрасывает сводку по объектам только своей организации (F-R35-2)', async () => {
    await invalidateSiteAnalytics('tenant-a');

    expect(mocks.patternInvalidate).toHaveBeenCalledWith('analytics:sites:v3:tenant-a:*');
    expect(mocks.patternInvalidate).toHaveBeenCalledTimes(1);
    expect(mocks.recordDeletion).toHaveBeenCalled();
  });
});
