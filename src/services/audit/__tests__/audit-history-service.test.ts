/**
 * Карты имён истории изменений — сужение по организации.
 *
 * Раньше три `findMany` грузились целиком: открытие истории любой записи
 * вытягивало всех пользователей, все объекты и всю технику системы, чтобы
 * подставить подписи вместо идентификаторов. Единственное место, где такой
 * список оказывался в памяти по запросу к одной сущности.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    feedbackEvent: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';
import { getEntityHistory } from '../audit-history-service';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe('getEntityHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of [db.user, db.site, db.equipment]) {
      asMock(m.findMany).mockResolvedValue([]);
    }
  });

  it('без событий не строит карты имён вовсе', async () => {
    asMock(db.feedbackEvent.findMany).mockResolvedValue([]);

    expect(await getEntityHistory('report', 'rep-1', 'orion')).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it('карты имён сужены организацией смотрящего', async () => {
    asMock(db.feedbackEvent.findMany).mockResolvedValue([
      { id: 'e1', action: 'updated', title: 'Изменено', actorName: 'Админ', actorRole: 'ADMIN', createdAt: new Date('2026-05-02'), metadata: null },
    ]);

    await getEntityHistory('report', 'rep-1', 'orion');

    for (const m of [db.user, db.site, db.equipment]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'orion' } }),
      );
    }
  });

  it('событие документа работника подписано по-русски, а не машинным кодом', async () => {
    asMock(db.feedbackEvent.findMany).mockResolvedValue([
      {
        id: 'e1',
        action: 'user.document.updated',
        title: 'user.document.updated',
        actorName: null,
        actorRole: null,
        createdAt: new Date('2026-05-02'),
        metadata: { documentId: 'doc-1', typeId: 'type-1', expiresAt: '2027-05-01T00:00:00.000Z', selfService: false },
      },
    ]);

    const [entry] = await getEntityHistory('users', 'usr-1', 'orion');

    expect(entry.action).toBe('user.document.updated');
    expect(entry.title).toBe('Документ работника изменён');
  });

  it('поля документов и допусков подписаны: «Действует до», «Вид документа», «Статус», «Вид техники»', async () => {
    asMock(db.feedbackEvent.findMany).mockResolvedValue([
      {
        id: 'e2',
        action: 'user.equipment_permit.saved',
        title: 'user.equipment_permit.saved',
        actorName: null,
        actorRole: null,
        createdAt: new Date('2026-05-02'),
        metadata: {
          before: { typeId: 'type-1', expiresAt: '2026-05-01T00:00:00.000Z', equipmentKind: 'PILE_DRIVER', status: 'DENIED' },
          after: { typeId: 'type-2', expiresAt: '2027-05-01T00:00:00.000Z', equipmentKind: 'DRILLING_RIG', status: 'ALLOWED' },
        },
      },
    ]);

    const [entry] = await getEntityHistory('users', 'usr-1', 'orion');

    expect(entry.changes).toEqual([
      { label: 'Вид документа', before: 'type-1', after: 'type-2' },
      { label: 'Действует до', before: '2026-05-01T00:00:00.000Z', after: '2027-05-01T00:00:00.000Z' },
      { label: 'Вид техники', before: 'PILE_DRIVER', after: 'DRILLING_RIG' },
      { label: 'Статус', before: 'DENIED', after: 'ALLOWED' },
    ]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['пустая строка', ''],
  ])('организация %s — отказ, а не карты по всем организациям', async (_label, tenantId) => {
    asMock(db.feedbackEvent.findMany).mockResolvedValue([
      { id: 'e1', action: 'updated', title: 'Изменено', actorName: null, actorRole: null, createdAt: new Date(), metadata: null },
    ]);

    await expect(getEntityHistory('report', 'rep-1', tenantId)).rejects.toThrow(
      'Контекст организации не определён',
    );
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
