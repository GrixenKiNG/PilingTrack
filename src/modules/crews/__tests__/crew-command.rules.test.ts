/**
 * Crew Command Service — правила состава бригады и закрепления установки.
 *
 * Покрывает риск, которого не было в существующих спеках:
 * - «одна активная бригада на установку» на путях ПРАВКИ (перенос установки,
 *   реактивация) — проверка с исключением самой бригады из запроса;
 * - целостность организации (site = якорь тенанта): установка/машинист/
 *   помощник из другого арендатора не принимаются;
 * - деактивация освобождает установку: конфликт проверяется только среди
 *   активных бригад, а soft-delete сам проверку не запускает.
 *
 * Репозиторий мокается: спека проверяет правила сервиса, а не Prisma.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrewAggregate } from '../domain';
import type { CrewRepository } from '../infrastructure';
import { createCrew, updateCrew, deleteCrew } from '../application/commands/crew-command.service';

// ============================================================
// Mocks
// ============================================================

const mockCrewResponse = {
  id: 'crew-1',
  name: 'Альфа',
  operatorId: 'op-1',
  equipmentId: 'equip-1',
  siteId: 'site-1',
  isActive: true,
  assistants: [],
};

const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-1' }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  equipment: {
    findUnique: vi.fn().mockResolvedValue({ id: 'equip-1', tenantId: 'tenant-1' }),
  },
  site: {
    findUnique: vi.fn().mockResolvedValue({ id: 'site-1', tenantId: 'tenant-1' }),
  },
  crew: {
    findUnique: vi.fn(),
    findFirst: vi.fn().mockResolvedValue(null),
  },
  crewAssistant: {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};

vi.mock('@/lib/db', () => ({
  get db() {
    return mockDb;
  },
  DEFAULT_TX_OPTIONS: { timeout: 10000, maxWait: 5000 },
}));

vi.mock('@/services/audit/audit-service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/cached-queries', () => ({
  invalidateCrews: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: tx client is the mock db
const mockRepoSave = vi.fn(async (_aggregate: unknown, hooks?: { onBeforeCommit?: (tx: any) => Promise<void> }) => {
  if (hooks?.onBeforeCommit) await hooks.onBeforeCommit(mockDb);
});
const mockRepoFindById = vi.fn().mockResolvedValue(null);

const mockRepo: CrewRepository = {
  save: mockRepoSave,
  findById: mockRepoFindById,
};

vi.mock('../infrastructure', () => ({
  getCrewRepository: () => mockRepo,
}));

// ============================================================
// Helpers
// ============================================================

function activeAggregate(equipmentId = 'equip-1') {
  return CrewAggregate.create(
    { name: 'Альфа', operatorId: 'op-1', equipmentId, siteId: 'site-1' },
    'user-1',
  );
}

// ============================================================
// Tests
// ============================================================

describe('Crew Command Service — состав и закрепление установки', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoFindById.mockResolvedValue(null);
    mockDb.user.findUnique.mockResolvedValue({ id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-1' });
    mockDb.user.findMany.mockResolvedValue([]);
    mockDb.equipment.findUnique.mockResolvedValue({ id: 'equip-1', tenantId: 'tenant-1' });
    mockDb.site.findUnique.mockResolvedValue({ id: 'site-1', tenantId: 'tenant-1' });
    mockDb.crew.findUnique.mockResolvedValue(mockCrewResponse);
    mockDb.crew.findFirst.mockResolvedValue(null);
    mockDb.crewAssistant.findMany.mockResolvedValue([]);
  });

  // --------------------------------------------------------
  // 1. Одна активная бригада на установку (создание)
  // --------------------------------------------------------
  describe('закрепление установки при создании', () => {
    it('не отдаёт установку второй бригаде и называет занявшую', async () => {
      mockDb.crew.findFirst.mockResolvedValue({ id: 'other-crew', name: 'Бета' });

      await expect(
        createCrew({ name: 'Гамма', operatorId: 'op-2', equipmentId: 'equip-1', siteId: 'site-1' }),
      ).rejects.toThrow('Установка уже закреплена за активной бригадой «Бета»');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('ищет конфликт только среди активных бригад', async () => {
      await createCrew({ name: 'Альфа', operatorId: 'op-1', equipmentId: 'equip-1', siteId: 'site-1' });

      const conflictCall = mockDb.crew.findFirst.mock.calls.find(([arg]) => arg?.where?.equipmentId);
      expect(conflictCall?.[0]?.where).toEqual({ equipmentId: 'equip-1', isActive: true });
    });
  });

  // --------------------------------------------------------
  // 2. Одна активная бригада на установку (правка)
  // --------------------------------------------------------
  describe('закрепление установки при правке', () => {
    it('отклоняет перенос на установку, занятую другой активной бригадой', async () => {
      const aggregate = activeAggregate('equip-old');
      mockRepoFindById.mockResolvedValue(aggregate);
      mockDb.equipment.findUnique.mockResolvedValue({ id: 'equip-taken', tenantId: 'tenant-1' });
      // Текущая тройка бригады (organizations match) — читается перед проверкой занятости.
      mockDb.crew.findUnique.mockResolvedValue({
        operator: { tenantId: 'tenant-1' },
        equipment: { tenantId: 'tenant-1' },
        site: { tenantId: 'tenant-1' },
      });
      mockDb.crew.findFirst.mockImplementation(async (arg: { where?: { equipmentId?: string } }) => {
        if (arg?.where?.equipmentId) return { id: 'other-crew', name: 'Бета' };
        return { id: 'crew-1' }; // проверка владения по тенанту
      });

      await expect(
        updateCrew({ crewId: 'crew-1', equipmentId: 'equip-taken', tenantId: 'tenant-1', userId: 'u' }),
      ).rejects.toThrow(/Установка уже закреплена/);

      expect(mockRepoSave).not.toHaveBeenCalled();
      // Сама бригада исключена из проверки — иначе пересохранение ловило бы себя.
      const conflictCall = mockDb.crew.findFirst.mock.calls.find(([arg]) => arg?.where?.equipmentId);
      expect(conflictCall?.[0]?.where).toEqual({
        equipmentId: 'equip-taken',
        isActive: true,
        id: { not: 'crew-1' },
      });
    });

    it('отклоняет реактивацию, когда установку уже заняла другая активная бригада', async () => {
      const aggregate = activeAggregate('equip-1');
      aggregate.deactivate('user-1');
      aggregate.clearPendingEvents();
      mockRepoFindById.mockResolvedValue(aggregate);
      mockDb.crew.findFirst.mockImplementation(async (arg: { where?: { equipmentId?: string } }) => {
        if (arg?.where?.equipmentId) return { id: 'other-crew', name: 'Бета' };
        return { id: 'crew-1' };
      });

      await expect(
        updateCrew({ crewId: 'crew-1', isActive: true, tenantId: 'tenant-1', userId: 'u' }),
      ).rejects.toThrow(/Установка уже закреплена/);

      expect(mockRepoSave).not.toHaveBeenCalled();
      // Смену флага проверяем по собственной установке бригады.
      const conflictCall = mockDb.crew.findFirst.mock.calls.find(([arg]) => arg?.where?.equipmentId);
      expect(conflictCall?.[0]?.where).toMatchObject({ equipmentId: 'equip-1', isActive: true });
    });
  });

  // --------------------------------------------------------
  // 3. Состав бригады — целостность организации
  // --------------------------------------------------------
  describe('состав бригады', () => {
    it('отклоняет помощника из другой организации', async () => {
      mockDb.user.findMany.mockResolvedValue([{ id: 'asst-1', name: 'Иван', tenantId: 'tenant-2' }]);

      await expect(
        createCrew({
          name: 'Альфа',
          operatorId: 'op-1',
          equipmentId: 'equip-1',
          siteId: 'site-1',
          assistantUserIds: ['asst-1'],
        }),
      ).rejects.toThrow('Помощник принадлежит другому арендатору');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('отклоняет установку другого арендатора', async () => {
      mockDb.equipment.findUnique.mockResolvedValue({ id: 'equip-1', tenantId: 'tenant-2' });

      await expect(
        createCrew({ name: 'Альфа', operatorId: 'op-1', equipmentId: 'equip-1', siteId: 'site-1' }),
      ).rejects.toThrow('Установка принадлежит другому арендатору');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('отклоняет машиниста другого арендатора', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-2' });

      await expect(
        createCrew({ name: 'Альфа', operatorId: 'op-1', equipmentId: 'equip-1', siteId: 'site-1' }),
      ).rejects.toThrow('Оператор принадлежит другому арендатору');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // 4. Деактивация
  // --------------------------------------------------------
  describe('деактивация', () => {
    it('расформировывает бригаду, не запуская проверку конфликта по установке', async () => {
      const aggregate = activeAggregate('equip-1');
      mockRepoFindById.mockResolvedValue(aggregate);
      mockDb.crew.findFirst.mockResolvedValue({ id: 'crew-1' });

      const result = await deleteCrew({ crewId: 'crew-1', tenantId: 'tenant-1', userId: 'u' });

      expect(result).toEqual({ success: true, deactivated: true });
      expect(aggregate.getState().isActive).toBe(false);

      // Установка освобождается: расформирование не должно запирать её проверкой занятости.
      const conflictCalls = mockDb.crew.findFirst.mock.calls.filter(([arg]) => arg?.where?.isActive === true);
      expect(conflictCalls).toHaveLength(0);
    });
  });
});
