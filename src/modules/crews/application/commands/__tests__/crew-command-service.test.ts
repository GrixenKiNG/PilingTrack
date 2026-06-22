/**
 * Crew Command Service — Integration Tests
 *
 * Tests the complete write path:
 * - Validation
 * - Dependency checks
 * - Aggregate persistence
 * - Soft delete (deactivate)
 * - Idempotency
 * - Error handling
 *
 * Uses mock repository to avoid database dependency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrewAggregate } from '../../../domain';
import type { CrewRepository } from '../../../infrastructure';
import { createCrew, updateCrew, deleteCrew } from '../crew-command.service';

// ============================================================
// Mocks
// ============================================================

const mockCrew = {
  id: 'crew-1',
  name: 'Test Crew',
  operatorId: 'operator-1',
  equipmentId: 'equip-1',
  siteId: 'site-1',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  operator: { id: 'operator-1', name: 'Test Operator', email: 'test@test.com', role: 'OPERATOR' },
  equipment: { id: 'equip-1', name: 'Test Equipment', model: 'Test Model' },
  site: { id: 'site-1', name: 'Test Site' },
  assistants: [],
};

// Mock database
const mockDb = {
  user: {
    findUnique: vi.fn().mockResolvedValue({ id: 'operator-1', role: 'OPERATOR' }),
  },
  equipment: {
    findUnique: vi.fn().mockResolvedValue({ id: 'equip-1', name: 'Test Equipment' }),
  },
  site: {
    findUnique: vi.fn().mockResolvedValue({ id: 'site-1', name: 'Test Site' }),
  },
  crew: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(mockCrew),
    update: vi.fn().mockResolvedValue(mockCrew),
    delete: vi.fn().mockResolvedValue(mockCrew),
    findMany: vi.fn().mockResolvedValue([]),
  },
  crewAssistant: {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  report: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
    return fn(mockDb);
  }),
  outboxEvent: {
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue({}),
  },
};

vi.mock('@/lib/db', () => ({
  get db() { return mockDb; },
  DEFAULT_TX_OPTIONS: { timeout: 10000, maxWait: 5000 },
}));

// Mock repository — wraps mockDb
const mockRepoSave = vi.fn().mockResolvedValue(undefined);
const mockRepoFindById = vi.fn().mockResolvedValue(null);

const mockRepo: CrewRepository = {
  save: mockRepoSave,
  findById: mockRepoFindById,
};

vi.mock('../../../infrastructure', () => ({
  getCrewRepository: () => mockRepo,
}));

// ============================================================
// Tests
// ============================================================

describe('Crew Command Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoFindById.mockResolvedValue(null);
    mockDb.crew.findUnique.mockResolvedValue(null);
    mockDb.crew.findFirst.mockResolvedValue(null);
    mockDb.crewAssistant.findMany.mockResolvedValue([]);
    mockDb.user.findUnique.mockResolvedValue({ id: 'operator-1', role: 'OPERATOR' });
    mockDb.equipment.findUnique.mockResolvedValue({ id: 'equip-1' });
    mockDb.site.findUnique.mockResolvedValue({ id: 'site-1' });
  });

  // --------------------------------------------------------
  // 1. Create crew
  // --------------------------------------------------------
  describe('createCrew', () => {
    it('should create a new crew with valid data', async () => {
      await createCrew({
        name: 'Alpha Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
        userId: 'user-1',
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
      expect(mockDb.crew.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: expect.any(String) } })
      );
    });

    it('should reject crew with missing operatorId', async () => {
      await expect(createCrew({
        name: 'Alpha',
        operatorId: '',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('operatorId, equipmentId, and siteId are required');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('should reject crew with missing equipmentId', async () => {
      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: '',
        siteId: 'site-1',
      })).rejects.toThrow('operatorId, equipmentId, and siteId are required');
    });

    it('should reject crew with missing siteId', async () => {
      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: '',
      })).rejects.toThrow('operatorId, equipmentId, and siteId are required');
    });

    it('should reject crew if operator not found', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'nonexistent',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Operator not found');
    });

    it('should reject crew if user is not OPERATOR', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'operator-1', role: 'DISPATCHER' });

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('User must have OPERATOR role');
    });

    it('should reject crew if operator already has a crew', async () => {
      mockDb.crew.findUnique.mockResolvedValue({ id: 'existing-crew' });

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Operator already has a crew');
    });

    it('should reject crew if equipment not found', async () => {
      mockDb.equipment.findUnique.mockResolvedValue(null);

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'nonexistent',
        siteId: 'site-1',
      })).rejects.toThrow('Equipment not found');
    });

    it('should reject crew if site not found', async () => {
      mockDb.site.findUnique.mockResolvedValue(null);

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'nonexistent',
      })).rejects.toThrow('Site not found');
    });

    it('should use default name when empty', async () => {
      await createCrew({
        name: '',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------
  // 2. Update crew
  // --------------------------------------------------------
  describe('updateCrew', () => {
    it('should update crew name', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Old Name',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      mockRepoFindById.mockResolvedValue(aggregate);

      await updateCrew({
        crewId: 'crew-1',
        name: 'New Name',
        userId: 'user-1',
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('should deactivate crew via update', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      mockRepoFindById.mockResolvedValue(aggregate);

      await updateCrew({
        crewId: 'crew-1',
        isActive: false,
        userId: 'user-1',
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
      // Verify aggregate was deactivated
      expect(aggregate.getState().isActive).toBe(false);
    });

    it('should ignore unchanged active status on update', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      aggregate.clearPendingEvents();
      mockRepoFindById.mockResolvedValue(aggregate);

      await updateCrew({
        crewId: 'crew-1',
        isActive: true,
        userId: 'user-1',
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
      expect(aggregate.getState().isActive).toBe(true);
    });

    it('should reject update if crew not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(updateCrew({
        crewId: 'nonexistent',
        name: 'New Name',
      })).rejects.toThrow('Crew not found');
    });
  });

  // --------------------------------------------------------
  // 3. Delete crew (soft delete)
  // --------------------------------------------------------
  describe('deleteCrew', () => {
    it('should soft delete (deactivate) an active crew', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      mockRepoFindById.mockResolvedValue(aggregate);

      const result = await deleteCrew({
        crewId: 'crew-1',
        userId: 'user-1',
      });

      expect(result).toEqual({ success: true, deactivated: true });
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
      expect(aggregate.getState().isActive).toBe(false);
    });

    it('should reject delete if crew not found', async () => {
      mockRepoFindById.mockResolvedValue(null);

      await expect(deleteCrew({ crewId: 'nonexistent' }))
        .rejects.toThrow('Crew not found');
    });

    it('should reject delete if crew already deactivated (idempotency)', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      aggregate.deactivate('user-1');
      aggregate.clearPendingEvents();
      mockRepoFindById.mockResolvedValue(aggregate);

      await expect(deleteCrew({ crewId: 'crew-1' }))
        .rejects.toThrow('Crew is already deactivated');

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('soft delete must never hard-delete the crew reports', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      mockRepoFindById.mockResolvedValue(aggregate);

      await deleteCrew({ crewId: 'crew-1', userId: 'user-1' });

      // The destructive force path (deleteMany reports + crew.delete) is gone.
      expect(mockDb.report.deleteMany).not.toHaveBeenCalled();
      expect(mockDb.crew.delete).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------
  // 4. Idempotency
  // --------------------------------------------------------
  describe('idempotency', () => {
    it('should not create duplicate crews for same operator (unique constraint)', async () => {
      mockDb.crew.findUnique.mockResolvedValue({ id: 'existing-crew' });

      // First call should fail due to conflict check
      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Operator already has a crew');
    });

    it('deactivate should be idempotent — reject on second call', async () => {
      const aggregate = CrewAggregate.create({
        name: 'Test Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      }, 'user-1');
      aggregate.deactivate('user-1');
      aggregate.clearPendingEvents();
      mockRepoFindById.mockResolvedValue(aggregate);

      // Second deactivate should fail
      await expect(deleteCrew({ crewId: 'crew-1' }))
        .rejects.toThrow('Crew is already deactivated');
    });
  });

  // --------------------------------------------------------
  // 5. Error handling
  // --------------------------------------------------------
  describe('error handling', () => {
    it('should convert UNIQUE constraint error to 409', async () => {
      mockRepoSave.mockRejectedValueOnce(new Error('UNIQUE constraint failed: Crew.operatorId'));

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Crew with this operator already exists');
    });

    it('should convert FOREIGN KEY error to 400', async () => {
      mockRepoSave.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'));

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Invalid crew dependencies');
    });

    it('should wrap unknown errors as 500', async () => {
      mockRepoSave.mockRejectedValueOnce(new Error('Unknown database error'));

      await expect(createCrew({
        name: 'Alpha',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
      })).rejects.toThrow('Failed to create crew');
    });
  });
});
