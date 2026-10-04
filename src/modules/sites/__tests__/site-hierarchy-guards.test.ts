/**
 * Иерархия объекта (объект → поле → куст → пикет), запрет удаления при
 * наличии отчётов и изоляция по организации.
 *
 * Проверяется поведение с ценой ошибки:
 *  - узел дерева нельзя открепить от объекта (куст на поле чужого объекта,
 *    пикет на кусте чужого объекта) — иначе работа утечёт на чужой объект;
 *  - выработку (сваи + бурение) считают по ВСЕМУ поддереву узла и по нужному
 *    срезу (`picketId` / `picket.clusterId` / `picket.cluster.fieldId`), иначе
 *    удаление молча теряет место работ (FK `picketId` — ON DELETE SET NULL);
 *  - объект не удаляется, пока на нём есть отчёты, даже если бригад нет;
 *  - без организации (tenantId) ни запись, ни удаление не выполняются.
 *
 * Исходный код не менялся.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  // Клиент интерактивной транзакции: удаление узла и подсчёт выработки идут в нём.
  const tx = {
    $queryRaw: vi.fn(),
    pileWork: { count: vi.fn() },
    leaderDrilling: { count: vi.fn() },
    pileField: { findFirst: vi.fn(), delete: vi.fn() },
    cluster: { findFirst: vi.fn(), delete: vi.fn() },
    picket: { findFirst: vi.fn(), delete: vi.fn() },
  };
  return {
    tx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- транзакционный шим для теста
    transaction: vi.fn((fn: any) => fn(tx)),
    siteFindFirst: vi.fn(),
    siteDelete: vi.fn(),
    pileFieldCreate: vi.fn(),
    pileFieldFindFirst: vi.fn(),
    clusterCreate: vi.fn(),
    clusterFindFirst: vi.fn(),
    picketCreate: vi.fn(),
    picketFindFirst: vi.fn(),
    crewCount: vi.fn(),
    reportCount: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: m.transaction,
    site: { findFirst: m.siteFindFirst, delete: m.siteDelete },
    pileField: { create: m.pileFieldCreate, findFirst: m.pileFieldFindFirst },
    cluster: { create: m.clusterCreate, findFirst: m.clusterFindFirst },
    picket: { create: m.picketCreate, findFirst: m.picketFindFirst },
    crew: { count: m.crewCount },
    report: { count: m.reportCount },
  },
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: vi.fn() }));

import {
  createSiteHierarchyItem,
  deleteSiteHierarchyItem,
  hardDeleteSite,
} from '../application/commands/site-admin-command.service';

const ctx = { tenantId: 't1', actorId: 'a1' };

beforeEach(() => {
  vi.clearAllMocks();
  m.siteFindFirst.mockResolvedValue({ id: 's1', tenantId: 't1' });
});

// ────────────────────────────────────────────
// Объект → поле → куст → пикет (создание)
// ────────────────────────────────────────────

describe('createSiteHierarchyItem — привязка к объекту', () => {
  it('поле не требует родителя и создаётся на своём объекте', async () => {
    m.pileFieldCreate.mockResolvedValue({ id: 'f1', name: 'Поле А', siteId: 's1' });

    await createSiteHierarchyItem({ siteId: 's1', type: 'field', name: '  Поле А  ' }, ctx);

    expect(m.pileFieldCreate).toHaveBeenCalledWith({ data: { name: 'Поле А', siteId: 's1' } });
  });

  it('куст привязывается только к полю того же объекта', async () => {
    m.pileFieldFindFirst.mockResolvedValue({ id: 'f1' });
    m.clusterCreate.mockResolvedValue({ id: 'c1' });

    await createSiteHierarchyItem({ siteId: 's1', type: 'cluster', name: 'Куст 1', parentId: 'f1' }, ctx);

    expect(m.pileFieldFindFirst).toHaveBeenCalledWith({ where: { id: 'f1', siteId: 's1' }, select: { id: true } });
    expect(m.clusterCreate).toHaveBeenCalledWith({ data: { name: 'Куст 1', fieldId: 'f1' } });
  });

  it('куст на поле чужого объекта отклоняется (404) и не создаётся', async () => {
    m.pileFieldFindFirst.mockResolvedValue(null);

    await expect(
      createSiteHierarchyItem({ siteId: 's1', type: 'cluster', name: 'Куст 1', parentId: 'foreign-field' }, ctx),
    ).rejects.toThrow('Parent not found');
    expect(m.clusterCreate).not.toHaveBeenCalled();
  });

  it('пикет привязывается только к кусту того же объекта', async () => {
    m.clusterFindFirst.mockResolvedValue({ id: 'c1' });
    m.picketCreate.mockResolvedValue({ id: 'p1' });

    await createSiteHierarchyItem({ siteId: 's1', type: 'picket', name: 'Пикет 1', parentId: 'c1' }, ctx);

    expect(m.clusterFindFirst).toHaveBeenCalledWith({ where: { id: 'c1', field: { siteId: 's1' } }, select: { id: true } });
    expect(m.picketCreate).toHaveBeenCalledWith({ data: { name: 'Пикет 1', clusterId: 'c1' } });
  });

  it('пикет на кусте чужого объекта отклоняется (404) и не создаётся', async () => {
    m.clusterFindFirst.mockResolvedValue(null);

    await expect(
      createSiteHierarchyItem({ siteId: 's1', type: 'picket', name: 'Пикет 1', parentId: 'foreign-cluster' }, ctx),
    ).rejects.toThrow('Parent not found');
    expect(m.picketCreate).not.toHaveBeenCalled();
  });

  it('без организации (tenantId) узел не создаётся', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's1', type: 'field', name: 'Поле А' }, { tenantId: '', actorId: 'a1' }),
    ).rejects.toThrow('tenantId is required');
    expect(m.pileFieldCreate).not.toHaveBeenCalled();
  });

  it('объект чужой организации не находится (404) — узел не создаётся', async () => {
    m.siteFindFirst.mockResolvedValue(null);

    await expect(
      createSiteHierarchyItem({ siteId: 's1', type: 'field', name: 'Поле А' }, ctx),
    ).rejects.toThrow('Site not found');
    expect(m.pileFieldCreate).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────
// Подсчёт выработки в поддереве (удаление узла)
// ────────────────────────────────────────────

describe('deleteSiteHierarchyItem — выработка в поддереве', () => {
  beforeEach(() => {
    m.tx.$queryRaw.mockResolvedValue([{ id: 'x' }]);
    m.tx.pileWork.count.mockResolvedValue(0);
    m.tx.leaderDrilling.count.mockResolvedValue(0);
    m.tx.pileField.findFirst.mockResolvedValue({ id: 'f1' });
    m.tx.cluster.findFirst.mockResolvedValue({ id: 'c1' });
    m.tx.picket.findFirst.mockResolvedValue({ id: 'p1' });
    m.tx.pileField.delete.mockResolvedValue({ id: 'f1' });
    m.tx.cluster.delete.mockResolvedValue({ id: 'c1' });
    m.tx.picket.delete.mockResolvedValue({ id: 'p1' });
  });

  it('пикет считает выработку строго по своему picketId (не задевая соседей)', async () => {
    await deleteSiteHierarchyItem('s1', 'picket', 'p1', ctx);

    expect(m.tx.pileWork.count).toHaveBeenCalledWith({ where: { picketId: 'p1' } });
    expect(m.tx.leaderDrilling.count).toHaveBeenCalledWith({ where: { picketId: 'p1' } });
    expect(m.tx.picket.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('куст считает выработку всех своих пикетов', async () => {
    await deleteSiteHierarchyItem('s1', 'cluster', 'c1', ctx);

    expect(m.tx.pileWork.count).toHaveBeenCalledWith({ where: { picket: { clusterId: 'c1' } } });
    expect(m.tx.leaderDrilling.count).toHaveBeenCalledWith({ where: { picket: { clusterId: 'c1' } } });
    expect(m.tx.cluster.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('поле считает выработку пикетов всех своих кустов', async () => {
    await deleteSiteHierarchyItem('s1', 'field', 'f1', ctx);

    expect(m.tx.pileWork.count).toHaveBeenCalledWith({ where: { picket: { cluster: { fieldId: 'f1' } } } });
    expect(m.tx.leaderDrilling.count).toHaveBeenCalledWith({ where: { picket: { cluster: { fieldId: 'f1' } } } });
    expect(m.tx.pileField.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });

  it('поле не удаляется (409), если выработка есть только в бурении поддерева', async () => {
    m.tx.pileWork.count.mockResolvedValue(0);
    m.tx.leaderDrilling.count.mockResolvedValue(3);

    await expect(deleteSiteHierarchyItem('s1', 'field', 'f1', ctx)).rejects.toThrow(
      'Нельзя удалить поле: на нём 3 записей выработки. Сначала перенесите их.',
    );
    expect(m.tx.pileField.delete).not.toHaveBeenCalled();
  });

  it('куст не удаляется (409), если в его пикетах есть сваи', async () => {
    m.tx.pileWork.count.mockResolvedValue(4);

    await expect(deleteSiteHierarchyItem('s1', 'cluster', 'c1', ctx)).rejects.toThrow(/Нельзя удалить куст/);
    expect(m.tx.cluster.delete).not.toHaveBeenCalled();
  });

  it('узел чужого объекта не удаляется (404) — транзакция не открывается', async () => {
    m.siteFindFirst.mockResolvedValue(null);

    await expect(deleteSiteHierarchyItem('s1', 'picket', 'p1', ctx)).rejects.toThrow('Site not found');
    expect(m.transaction).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────
// Полное удаление объекта — запрет при наличии отчётов
// ────────────────────────────────────────────

describe('hardDeleteSite — запрет при отчётах', () => {
  it('объект с отчётами не удаляется (409), даже если бригад нет', async () => {
    m.crewCount.mockResolvedValue(0);
    m.reportCount.mockResolvedValue(5);

    await expect(hardDeleteSite('s1', ctx)).rejects.toThrow(
      'Нельзя удалить: 0 бригад, 5 отчётов. Деактивируйте объект.',
    );
    expect(m.siteDelete).not.toHaveBeenCalled();
  });

  it('объект без бригад и отчётов удаляется', async () => {
    m.crewCount.mockResolvedValue(0);
    m.reportCount.mockResolvedValue(0);
    m.siteDelete.mockResolvedValue({ id: 's1' });

    const result = await hardDeleteSite('s1', ctx);

    expect(m.siteDelete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(result).toEqual({ success: true });
  });

  it('без организации (tenantId) объект не удаляется и не ищется', async () => {
    await expect(hardDeleteSite('s1', { tenantId: '', actorId: 'a1' })).rejects.toThrow('tenantId is required');
    expect(m.siteDelete).not.toHaveBeenCalled();
    expect(m.reportCount).not.toHaveBeenCalled();
  });
});
