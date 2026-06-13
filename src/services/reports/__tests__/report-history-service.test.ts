import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    reportAudit: { findMany: vi.fn() },
    reportVersion: { findMany: vi.fn() },
    pileGrade: { findMany: vi.fn() },
    drillingType: { findMany: vi.fn() },
    downtimeReason: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';
import {
  actionLabel, statusLabel, humanizeDiff, getReportHistory, type NameLookups,
} from '../report-history-service';

const lookups: NameLookups = {
  pileGrade: { g1: 'С120-30', g2: 'С100-25' },
  drillingType: { t1: 'd=620 мм' },
  downtimeReason: { r1: 'Поломка копра' },
  site: { s1: 'Объект А', s2: 'Объект Б' },
  user: { u1: 'Иванов', u2: 'Петров' },
  equipment: { e1: 'Установка-1' },
};

describe('actionLabel / statusLabel', () => {
  it('maps known actions and falls back to raw', () => {
    expect(actionLabel('created')).toBe('Создан');
    expect(actionLabel('updated')).toBe('Изменён');
    expect(actionLabel('submitted')).toBe('Отправлен');
    expect(actionLabel('deleted')).toBe('Удалён');
    expect(actionLabel('weird')).toBe('weird');
  });
  it('maps statuses and falls back to raw', () => {
    expect(statusLabel('draft')).toBe('Черновик');
    expect(statusLabel('submitted')).toBe('Отправлен');
    expect(statusLabel('mystery')).toBe('mystery');
  });
});

describe('humanizeDiff', () => {
  it('renders pile changes by grade name and count', () => {
    const diff = { piles: { old: [{ pileGradeId: 'g1', count: 5 }], new: [{ pileGradeId: 'g1', count: 10 }, { pileGradeId: 'g2', count: 2 }] } };
    const changes = humanizeDiff(diff, lookups);
    expect(changes).toEqual([
      { label: 'Сваи', before: 'С120-30: 5 шт', after: 'С120-30: 10 шт; С100-25: 2 шт' },
    ]);
  });

  it('renders status via statusLabel', () => {
    const changes = humanizeDiff({ status: { old: 'draft', new: 'submitted' } }, lookups);
    expect(changes).toEqual([{ label: 'Статус', before: 'Черновик', after: 'Отправлен' }]);
  });

  it('resolves site changes by name', () => {
    const changes = humanizeDiff({ siteId: { old: 's1', new: 's2' } }, lookups);
    expect(changes).toEqual([{ label: 'Объект', before: 'Объект А', after: 'Объект Б' }]);
  });

  it('skips noise fields (version, updatedAt, lastEditedBy*)', () => {
    const diff = {
      version: { old: 1, new: 2 },
      updatedAt: { old: 'x', new: 'y' },
      lastEditedByName: { old: null, new: 'Иванов' },
    };
    expect(humanizeDiff(diff, lookups)).toEqual([]);
  });
});

describe('getReportHistory', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns humanized events (newest first) and versions', async () => {
    (db.reportAudit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', action: 'updated', actorName: 'Админ', actorRole: 'ADMIN', createdAt: new Date('2026-05-02'), diff: { status: { old: 'draft', new: 'submitted' } } },
      { id: 'a0', action: 'created', actorName: 'Иванов', actorRole: 'OPERATOR', createdAt: new Date('2026-05-01'), diff: null },
    ]);
    (db.reportVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { version: 2, actorId: 'u1', createdAt: new Date('2026-05-02') },
    ]);
    for (const m of [db.pileGrade, db.drillingType, db.downtimeReason, db.site, db.user, db.equipment]) {
      (m.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    }

    const res = await getReportHistory('rep-1');
    expect(db.reportAudit.findMany).toHaveBeenCalledWith({ where: { reportId: 'rep-1' }, orderBy: { createdAt: 'desc' } });
    expect(res.events[0]).toMatchObject({ id: 'a1', actionLabel: 'Изменён', actorName: 'Админ' });
    expect(res.events[0].changes).toEqual([{ label: 'Статус', before: 'Черновик', after: 'Отправлен' }]);
    expect(res.events[1].changes).toEqual([]);
    expect(res.versions).toEqual([{ version: 2, actorId: 'u1', createdAt: '2026-05-02T00:00:00.000Z' }]);
  });
});
