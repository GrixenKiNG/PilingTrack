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
