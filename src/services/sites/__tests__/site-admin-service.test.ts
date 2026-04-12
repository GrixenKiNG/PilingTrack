/**
 * Site Admin Service — Unit Tests
 *
 * Tests the complete write/read path:
 * - Validation
 * - Site creation with pile/drilling plans
 * - Site listing
 * - Site update with plan replacement
 * - Site deletion with report cleanup
 * - User assignment/unassignment
 * - Hierarchy item creation (field, cluster, picket)
 * - Hierarchy item deletion (field, cluster, picket)
 *
 * Uses mock Prisma to avoid database dependency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceError } from '@/services/service-error';

// ============================================================
// Mocks
// ============================================================

const mockDb = {
  site: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
  },
  sitePilePlan: { create: vi.fn(), deleteMany: vi.fn() },
  siteDrillingPlan: { create: vi.fn(), deleteMany: vi.fn() },
  report: { findMany: vi.fn(), deleteMany: vi.fn() },
  reportDowntime: { deleteMany: vi.fn() },
  pileWork: { deleteMany: vi.fn() },
  leaderDrilling: { deleteMany: vi.fn() },
  pileField: { create: vi.fn(), delete: vi.fn() },
  cluster: { create: vi.fn(), delete: vi.fn() },
  picket: { create: vi.fn(), delete: vi.fn() },
  userSiteAssignment: { upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
    return fn(mockDb);
  }),
};

vi.mock('@/lib/db', () => ({
  get db() { return mockDb; },
}));

// Import service functions after mock is set up
import {
  createSiteWithPlans,
  listAllSitesForAdmin,
  updateSiteWithPlans,
  deleteSite,
  assignUserToSite,
  unassignUserFromSite,
  createSiteHierarchyItem,
  deleteSiteHierarchyItem,
} from '../site-admin-service';

// ============================================================
// Helpers
// ============================================================

const mockSite = {
  id: 'site-1',
  name: 'Test Site',
  isActive: true,
  plannedPiles: 10,
  plannedDrilling: 50,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPilePlan = {
  id: 'pp-1',
  siteId: 'site-1',
  pileGradeId: 'grade-1',
  count: 5,
  metersPerUnit: 10,
  createdAt: new Date(),
};

const mockDrillingPlan = {
  id: 'dp-1',
  siteId: 'site-1',
  diameter: 300,
  count: 3,
  metersPerUnit: 15,
  createdAt: new Date(),
};

// ============================================================
// Tests
// ============================================================

describe('Site Admin Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.site.findUnique.mockResolvedValue(null);
    mockDb.site.create.mockResolvedValue(mockSite);
    mockDb.site.update.mockResolvedValue(mockSite);
    mockDb.site.findMany.mockResolvedValue([]);
    mockDb.sitePilePlan.create.mockResolvedValue(mockPilePlan);
    mockDb.sitePilePlan.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.siteDrillingPlan.create.mockResolvedValue(mockDrillingPlan);
    mockDb.siteDrillingPlan.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.report.findMany.mockResolvedValue([]);
    mockDb.report.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.reportDowntime.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.pileWork.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.leaderDrilling.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.pileField.create.mockResolvedValue({ id: 'field-1', name: 'Field 1', siteId: 'site-1' });
    mockDb.pileField.delete.mockResolvedValue({ id: 'field-1' });
    mockDb.cluster.create.mockResolvedValue({ id: 'cluster-1', name: 'Cluster 1', fieldId: 'field-1' });
    mockDb.cluster.delete.mockResolvedValue({ id: 'cluster-1' });
    mockDb.picket.create.mockResolvedValue({ id: 'picket-1', name: 'Picket 1', clusterId: 'cluster-1' });
    mockDb.picket.delete.mockResolvedValue({ id: 'picket-1' });
    mockDb.userSiteAssignment.upsert.mockResolvedValue({ userId: 'user-1', siteId: 'site-1' });
    mockDb.userSiteAssignment.deleteMany.mockResolvedValue({ count: 1 });
    mockDb.site.delete.mockResolvedValue(mockSite);
  });

  // --------------------------------------------------------
  // 1. createSiteWithPlans
  // --------------------------------------------------------
  describe('createSiteWithPlans', () => {
    it('should create a site with valid data', async () => {
      const result = await createSiteWithPlans({
        name: 'New Site',
        pilePlans: [{ pileGradeId: 'grade-1', count: 5, metersPerUnit: 10 }],
        drillingPlans: [{ diameter: 300, count: 3, metersPerUnit: 15 }],
      });

      expect(mockDb.$transaction).toHaveBeenCalled();
      expect(mockDb.site.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'New Site',
          plannedPiles: 5,
          plannedDrilling: 45, // 3 * 15
        }),
      });
    });

    it('should create pile plans within transaction', async () => {
      await createSiteWithPlans({
        name: 'New Site',
        pilePlans: [{ pileGradeId: 'grade-1', count: 5, metersPerUnit: 10 }],
      });

      expect(mockDb.sitePilePlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          siteId: mockSite.id,
          pileGradeId: 'grade-1',
          count: 5,
          metersPerUnit: 10,
        }),
      });
    });

    it('should create drilling plans within transaction', async () => {
      await createSiteWithPlans({
        name: 'New Site',
        drillingPlans: [{ diameter: 300, count: 3, metersPerUnit: 15 }],
      });

      expect(mockDb.siteDrillingPlan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          siteId: mockSite.id,
          diameter: 300,
          count: 3,
          metersPerUnit: 15,
        }),
      });
    });

    it('should reject site with empty name', async () => {
      await expect(createSiteWithPlans({ name: '' })).rejects.toThrow(ServiceError);
      await expect(createSiteWithPlans({ name: '' })).rejects.toThrow('Name required');
      expect(mockDb.site.create).not.toHaveBeenCalled();
    });

    it('should reject site with whitespace-only name', async () => {
      await expect(createSiteWithPlans({ name: '   ' })).rejects.toThrow(ServiceError);
      await expect(createSiteWithPlans({ name: '   ' })).rejects.toThrow('Name required');
    });

    it('should create site with no plans when arrays are empty', async () => {
      await createSiteWithPlans({ name: 'Empty Plans Site' });

      expect(mockDb.site.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Empty Plans Site',
          plannedPiles: 0,
          plannedDrilling: 0,
        }),
      });
    });

    it('should filter out invalid pile plans (missing pileGradeId)', async () => {
      await createSiteWithPlans({
        name: 'Site',
        pilePlans: [
          { count: 5 }, // invalid — no pileGradeId
          { pileGradeId: 'grade-1', count: 3 }, // valid
        ],
      });

      expect(mockDb.sitePilePlan.create).toHaveBeenCalledTimes(1);
      expect(mockDb.sitePilePlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pileGradeId: 'grade-1' }) })
      );
    });

    it('should filter out invalid drilling plans (count <= 0)', async () => {
      await createSiteWithPlans({
        name: 'Site',
        drillingPlans: [
          { count: 0 }, // invalid
          { count: -1 }, // invalid
          { diameter: 300, count: 2 }, // valid
        ],
      });

      expect(mockDb.siteDrillingPlan.create).toHaveBeenCalledTimes(1);
    });

    it('should trim site name', async () => {
      await createSiteWithPlans({ name: '  Trimmed Site  ' });

      expect(mockDb.site.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Trimmed Site' }),
        })
      );
    });
  });

  // --------------------------------------------------------
  // 2. listAllSitesForAdmin
  // --------------------------------------------------------
  describe('listAllSitesForAdmin', () => {
    it('should return list of sites with counts', async () => {
      const sites = [
        {
          id: 'site-1',
          name: 'Alpha Site',
          isActive: true,
          plannedPiles: 10,
          plannedDrilling: 50,
          _count: { pilePlans: 1, drillingPlans: 1 },
        },
      ];
      mockDb.site.findMany.mockResolvedValue(sites);

      const result = await listAllSitesForAdmin();

      expect(result).toEqual(sites);
      expect(mockDb.site.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          name: true,
          isActive: true,
          plannedPiles: true,
          plannedDrilling: true,
          _count: {
            select: {
              pilePlans: true,
              drillingPlans: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no sites exist', async () => {
      mockDb.site.findMany.mockResolvedValue([]);

      const result = await listAllSitesForAdmin();

      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // 3. updateSiteWithPlans
  // --------------------------------------------------------
  describe('updateSiteWithPlans', () => {
    it('should update site name and isActive', async () => {
      mockDb.site.findUnique.mockResolvedValue(mockSite);
      mockDb.site.update.mockResolvedValue({ ...mockSite, name: 'Updated Name', isActive: false });

      const result = await updateSiteWithPlans('site-1', {
        name: 'Updated Name',
        isActive: false,
      });

      expect(mockDb.site.findUnique).toHaveBeenCalledWith({ where: { id: 'site-1' } });
      expect(mockDb.site.update).toHaveBeenCalledWith({
        where: { id: 'site-1' },
        data: expect.objectContaining({
          name: 'Updated Name',
          isActive: false,
        }),
      });
    });

    it('should replace pile and drilling plans when provided', async () => {
      mockDb.site.findUnique.mockResolvedValue(mockSite);

      await updateSiteWithPlans('site-1', {
        name: 'Updated Site',
        pilePlans: [{ pileGradeId: 'grade-2', count: 10, metersPerUnit: 12 }],
        drillingPlans: [{ diameter: 400, count: 5, metersPerUnit: 20 }],
      });

      expect(mockDb.sitePilePlan.deleteMany).toHaveBeenCalledWith({ where: { siteId: 'site-1' } });
      expect(mockDb.siteDrillingPlan.deleteMany).toHaveBeenCalledWith({ where: { siteId: 'site-1' } });
      expect(mockDb.sitePilePlan.create).toHaveBeenCalled();
      expect(mockDb.siteDrillingPlan.create).toHaveBeenCalled();
    });

    it('should throw 404 if site not found', async () => {
      mockDb.site.findUnique.mockResolvedValue(null);

      await expect(updateSiteWithPlans('nonexistent', { name: 'New Name' }))
        .rejects.toThrow(ServiceError);
      await expect(updateSiteWithPlans('nonexistent', { name: 'New Name' }))
        .rejects.toThrow('Site not found');
      expect(mockDb.site.update).not.toHaveBeenCalled();
    });

    it('should trim name on update', async () => {
      mockDb.site.findUnique.mockResolvedValue(mockSite);

      await updateSiteWithPlans('site-1', { name: '  Trimmed  ' });

      expect(mockDb.site.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Trimmed' }),
        })
      );
    });
  });

  // --------------------------------------------------------
  // 4. deleteSite
  // --------------------------------------------------------
  describe('deleteSite', () => {
    it('should delete site and its reports', async () => {
      mockDb.site.findUnique.mockResolvedValue(mockSite);
      mockDb.report.findMany.mockResolvedValue([{ id: 'report-1' }]);

      const result = await deleteSite('site-1');

      expect(result).toEqual({ success: true });
      expect(mockDb.$transaction).toHaveBeenCalled();
      expect(mockDb.report.findMany).toHaveBeenCalledWith({
        where: { siteId: 'site-1' },
        select: { id: true },
      });
      expect(mockDb.reportDowntime.deleteMany).toHaveBeenCalledWith({ where: { reportId: 'report-1' } });
      expect(mockDb.pileWork.deleteMany).toHaveBeenCalledWith({ where: { reportId: 'report-1' } });
      expect(mockDb.leaderDrilling.deleteMany).toHaveBeenCalledWith({ where: { reportId: 'report-1' } });
      expect(mockDb.report.deleteMany).toHaveBeenCalledWith({ where: { siteId: 'site-1' } });
      expect(mockDb.site.delete).toHaveBeenCalledWith({ where: { id: 'site-1' } });
    });

    it('should throw 404 if site not found', async () => {
      mockDb.site.findUnique.mockResolvedValue(null);

      await expect(deleteSite('nonexistent'))
        .rejects.toThrow(ServiceError);
      await expect(deleteSite('nonexistent'))
        .rejects.toThrow('Site not found');
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it('should handle site with no reports', async () => {
      mockDb.site.findUnique.mockResolvedValue(mockSite);
      mockDb.report.findMany.mockResolvedValue([]);

      const result = await deleteSite('site-1');

      expect(result).toEqual({ success: true });
      expect(mockDb.report.deleteMany).toHaveBeenCalledWith({ where: { siteId: 'site-1' } });
    });
  });

  // --------------------------------------------------------
  // 5. assignUserToSite
  // --------------------------------------------------------
  describe('assignUserToSite', () => {
    it('should assign user to site via upsert', async () => {
      const result = await assignUserToSite('site-1', 'user-1');

      expect(mockDb.userSiteAssignment.upsert).toHaveBeenCalledWith({
        where: { userId_siteId: { userId: 'user-1', siteId: 'site-1' } },
        update: {},
        create: { userId: 'user-1', siteId: 'site-1' },
      });
    });

    it('should throw 400 if siteId is missing', async () => {
      await expect(assignUserToSite('', 'user-1'))
        .rejects.toThrow(ServiceError);
      await expect(assignUserToSite('', 'user-1'))
        .rejects.toThrow('userId and siteId required');
      expect(mockDb.userSiteAssignment.upsert).not.toHaveBeenCalled();
    });

    it('should throw 400 if userId is missing', async () => {
      await expect(assignUserToSite('site-1', ''))
        .rejects.toThrow(ServiceError);
      await expect(assignUserToSite('site-1', ''))
        .rejects.toThrow('userId and siteId required');
    });
  });

  // --------------------------------------------------------
  // 6. unassignUserFromSite
  // --------------------------------------------------------
  describe('unassignUserFromSite', () => {
    it('should remove user from site', async () => {
      const result = await unassignUserFromSite('site-1', 'user-1');

      expect(mockDb.userSiteAssignment.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', siteId: 'site-1' },
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw 400 if siteId is missing', async () => {
      await expect(unassignUserFromSite('', 'user-1'))
        .rejects.toThrow(ServiceError);
      await expect(unassignUserFromSite('', 'user-1'))
        .rejects.toThrow('userId and siteId required');
      expect(mockDb.userSiteAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw 400 if userId is missing', async () => {
      await expect(unassignUserFromSite('site-1', ''))
        .rejects.toThrow(ServiceError);
      await expect(unassignUserFromSite('site-1', ''))
        .rejects.toThrow('userId and siteId required');
    });
  });

  // --------------------------------------------------------
  // 7. createSiteHierarchyItem
  // --------------------------------------------------------
  describe('createSiteHierarchyItem', () => {
    it('should create a field', async () => {
      const result = await createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'field',
        name: 'Field 1',
      });

      expect(mockDb.pileField.create).toHaveBeenCalledWith({
        data: { name: 'Field 1', siteId: 'site-1' },
      });
    });

    it('should create a cluster with parentId', async () => {
      const result = await createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'cluster',
        name: 'Cluster 1',
        parentId: 'field-1',
      });

      expect(mockDb.cluster.create).toHaveBeenCalledWith({
        data: { name: 'Cluster 1', fieldId: 'field-1' },
      });
    });

    it('should throw 400 if cluster missing parentId', async () => {
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'cluster',
        name: 'Cluster 1',
      }))
        .rejects.toThrow(ServiceError);
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'cluster',
        name: 'Cluster 1',
      }))
        .rejects.toThrow('parentId required');
      expect(mockDb.cluster.create).not.toHaveBeenCalled();
    });

    it('should create a picket with parentId', async () => {
      const result = await createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'picket',
        name: 'Picket 1',
        parentId: 'cluster-1',
      });

      expect(mockDb.picket.create).toHaveBeenCalledWith({
        data: { name: 'Picket 1', clusterId: 'cluster-1' },
      });
    });

    it('should throw 400 if picket missing parentId', async () => {
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'picket',
        name: 'Picket 1',
      }))
        .rejects.toThrow(ServiceError);
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'picket',
        name: 'Picket 1',
      }))
        .rejects.toThrow('parentId required');
      expect(mockDb.picket.create).not.toHaveBeenCalled();
    });

    it('should throw 400 if type is missing', async () => {
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: '',
        name: 'Field 1',
      }))
        .rejects.toThrow(ServiceError);
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: '',
        name: 'Field 1',
      }))
        .rejects.toThrow('Type and name required');
    });

    it('should throw 400 if name is empty', async () => {
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'field',
        name: '',
      }))
        .rejects.toThrow(ServiceError);
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'field',
        name: '',
      }))
        .rejects.toThrow('Type and name required');
    });

    it('should throw 400 for invalid type', async () => {
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'invalid-type',
        name: 'Something',
      }))
        .rejects.toThrow(ServiceError);
      await expect(createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'invalid-type',
        name: 'Something',
      }))
        .rejects.toThrow('Invalid type');
    });

    it('should trim name on create', async () => {
      await createSiteHierarchyItem({
        siteId: 'site-1',
        type: 'field',
        name: '  Trimmed Field  ',
      });

      expect(mockDb.pileField.create).toHaveBeenCalledWith({
        data: { name: 'Trimmed Field', siteId: 'site-1' },
      });
    });
  });

  // --------------------------------------------------------
  // 8. deleteSiteHierarchyItem
  // --------------------------------------------------------
  describe('deleteSiteHierarchyItem', () => {
    it('should delete a field', async () => {
      const result = await deleteSiteHierarchyItem('field', 'field-1');

      expect(mockDb.pileField.delete).toHaveBeenCalledWith({ where: { id: 'field-1' } });
      expect(result).toEqual({ success: true });
    });

    it('should delete a cluster', async () => {
      const result = await deleteSiteHierarchyItem('cluster', 'cluster-1');

      expect(mockDb.cluster.delete).toHaveBeenCalledWith({ where: { id: 'cluster-1' } });
      expect(result).toEqual({ success: true });
    });

    it('should delete a picket', async () => {
      const result = await deleteSiteHierarchyItem('picket', 'picket-1');

      expect(mockDb.picket.delete).toHaveBeenCalledWith({ where: { id: 'picket-1' } });
      expect(result).toEqual({ success: true });
    });

    it('should throw 400 if type is missing', async () => {
      await expect(deleteSiteHierarchyItem('', 'field-1'))
        .rejects.toThrow(ServiceError);
      await expect(deleteSiteHierarchyItem('', 'field-1'))
        .rejects.toThrow('Type and itemId required');
      expect(mockDb.pileField.delete).not.toHaveBeenCalled();
    });

    it('should throw 400 if itemId is missing', async () => {
      await expect(deleteSiteHierarchyItem('field', ''))
        .rejects.toThrow(ServiceError);
      await expect(deleteSiteHierarchyItem('field', ''))
        .rejects.toThrow('Type and itemId required');
    });

    it('should throw 400 for invalid type', async () => {
      await expect(deleteSiteHierarchyItem('invalid-type', 'some-id'))
        .rejects.toThrow(ServiceError);
      await expect(deleteSiteHierarchyItem('invalid-type', 'some-id'))
        .rejects.toThrow('Invalid type');
    });
  });
});
