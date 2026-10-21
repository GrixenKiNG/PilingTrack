/**
 * Бригады — кэш списка сбрасывается сразу после коммита (находка Codex XP40).
 *
 * Раньше invalidateCrews() вызывался только в конце, после чтения ответа и
 * аудита. Сбой любого из них после записи оставлял в кэше устаревший список до
 * истечения TTL. Теперь сброс идёт сразу после сохранения: порядок commit →
 * invalidate → read. При отказе сохранения кэш не трогаем.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  order: [] as string[],
  save: vi.fn(),
  findById: vi.fn(),
  crewFindFirst: vi.fn(),
  crewFindUnique: vi.fn(),
  assistantsFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  equipmentFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  invalidate: vi.fn(),
  audit: vi.fn(),
  state: {
    id: 'crew-1',
    name: 'Бригада',
    operatorId: 'operator-1',
    equipmentId: 'equipment-1',
    siteId: 'site-1',
    isActive: true,
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    crew: {
      findFirst: m.crewFindFirst,
      findUnique: m.crewFindUnique,
    },
    crewAssistant: { findMany: m.assistantsFindMany },
    user: { findUnique: m.userFindUnique },
    equipment: { findUnique: m.equipmentFindUnique },
    site: { findUnique: m.siteFindUnique },
  },
}));

vi.mock('../../../domain', () => ({
  CrewAggregate: {
    create: () => ({ getState: () => ({ ...m.state }) }),
  },
}));

vi.mock('../../../infrastructure', () => ({
  getCrewRepository: () => ({
    save: m.save,
    findById: m.findById,
  }),
}));

vi.mock('@/lib/cached-queries', () => ({
  invalidateCrews: m.invalidate,
}));

vi.mock('@/modules/audit', () => ({
  recordAuditEvent: m.audit,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { createCrew, updateCrew } from '../crew-command.service';

describe('XP40: инвалидация после сохранения', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.order.length = 0;

    m.userFindUnique.mockResolvedValue({
      id: 'operator-1',
      role: 'OPERATOR',
      tenantId: 'tenant-1',
    });
    m.equipmentFindUnique.mockResolvedValue({
      id: 'equipment-1',
      tenantId: 'tenant-1',
    });
    m.siteFindUnique.mockResolvedValue({
      id: 'site-1',
      tenantId: 'tenant-1',
    });

    m.crewFindFirst.mockResolvedValue(null);
    m.assistantsFindMany.mockResolvedValue([]);
    m.findById.mockResolvedValue({
      getState: () => ({ ...m.state }),
    });

    m.save.mockImplementation(async () => {
      m.order.push('commit');
    });
    m.invalidate.mockImplementation(async () => {
      m.order.push('invalidate');
    });
    m.crewFindUnique.mockImplementation(async () => {
      m.order.push('read');
      throw new Error('response read failed');
    });
    m.audit.mockResolvedValue(undefined);
  });

  function run(kind: 'create' | 'update') {
    if (kind === 'create') {
      return createCrew({
        name: 'Бригада',
        operatorId: 'operator-1',
        equipmentId: 'equipment-1',
        siteId: 'site-1',
        userId: 'user-1',
      });
    }

    // Успешная проверка принадлежности организации.
    m.crewFindFirst.mockResolvedValue({
      id: 'crew-1',
      site: { tenantId: 'tenant-1' },
    });
    return updateCrew({
      crewId: 'crew-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  }

  it.each(['create', 'update'] as const)(
    '%s: инвалидирует после commit даже при отказе чтения ответа',
    async (kind) => {
      await expect(run(kind)).rejects.toThrow(
        'response read failed',
      );

      expect(m.save).toHaveBeenCalledTimes(1);
      expect(m.invalidate).toHaveBeenCalledTimes(1);
      expect(m.order).toEqual(['commit', 'invalidate', 'read']);
    },
  );

  it.each(['create', 'update'] as const)(
    '%s: не инвалидирует при отказе сохранения',
    async (kind) => {
      m.save.mockRejectedValue(new Error('save failed'));

      await expect(run(kind)).rejects.toThrow();

      expect(m.invalidate).not.toHaveBeenCalled();
      expect(m.crewFindUnique).not.toHaveBeenCalled();
    },
  );
});
