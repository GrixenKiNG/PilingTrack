/**
 * Report Command Service — Integration Tests
 *
 * Tests the complete write path:
 * - Validation
 * - Authorization (mocked)
 * - Aggregate creation
 * - Business rule enforcement
 * - Repository persistence
 * - Event generation
 *
 * Uses a mock repository to avoid database dependency.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportAggregate } from '../../../domain';
import type { ReportRepository } from '../../../infrastructure';
import { upsertReport, assertCanActForUser, resolveReportUserId } from '../report-command.service';
import type { UpsertReportCommand } from '../upsert-report.command';

// ============================================================
// Mocks
// ============================================================

// Mock authorization
vi.mock('@/services/auth/resource-access-service', () => ({
  assertUserAssignedToSite: vi.fn().mockResolvedValue(undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  resolveAccessibleUserId: vi.fn((_session: any, requested: string | null | undefined) => requested || 'user-1'),
  assertCanManageUserScope: vi.fn(),
}));

// Mock database
const mockReport = {
  id: 'report-internal-id',
  reportId: 'report-1',
  userId: 'user-1',
  siteId: 'site-1',
  date: '2026-04-05',
  shiftType: 'DAY',
  status: 'submitted',
  user: { id: 'user-1', name: 'Test User' },
  site: { id: 'site-1', name: 'Test Site' },
  equipment: null,
  crew: null,
  piles: [],
  drillings: [],
  downtimes: [],
};

const mockDb = {
  report: {
    findUnique: vi.fn().mockResolvedValue(mockReport),
    findMany: vi.fn().mockResolvedValue([]),
  },
  crew: {
    // Operator's crews are resolved on the report CREATE path to freeze crewId.
    findMany: vi.fn().mockResolvedValue([]),
  },
  shift: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  sitePilePlan: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

vi.mock('@/lib/db', () => ({
  get db() { return mockDb; },
}));

// Mock repository
const mockRepoSave = vi.fn().mockResolvedValue(undefined);
const mockRepoFindById = vi.fn().mockResolvedValue(null);

const mockRepo: ReportRepository = {
  save: mockRepoSave,
  findById: mockRepoFindById,
  findByUserIdAndDate: vi.fn().mockResolvedValue(null),
};

vi.mock('../../../infrastructure', () => ({
  getReportRepository: () => mockRepo,
}));

// ============================================================
// Tests
// ============================================================

describe('Report Command Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoFindById.mockResolvedValue(null);
    mockDb.report.findUnique.mockResolvedValue(mockReport);
  });

  describe('create new report', () => {
    it('should create a report with pile work', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        shiftType: 'DAY',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
      };

      const result = await upsertReport(input);

      expect(result._action).toBe('created');
      expect(result.report).toBeDefined();
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('should create a report with drilling', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-2',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        drillings: [{ typeId: 'type-1', count: 1, metersPerUnit: 10, meters: 10 }],
      };

      const result = await upsertReport(input);

      expect(result._action).toBe('created');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('should create a report with downtime', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-3',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 1 }],
        downtimes: [{ reasonId: 'reason-1', duration: 8 }],
      };

      const result = await upsertReport(input);

      expect(result._action).toBe('created');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('should reject report with no entries', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-4',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      };

      await expect(upsertReport(input)).rejects.toThrow(
        'Отчёт должен содержать хотя бы сваи, бурение или простой'
      );
      expect(mockRepoSave).not.toHaveBeenCalled();
    });
  });

  describe('update existing report', () => {
    it('should update an existing report', async () => {
      const existingAggregate = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      // Add initial data
      existingAggregate.addPileWork({ pileGradeId: 'grade-1', count: 3 }, 'user-1');

      mockRepoFindById.mockResolvedValue(existingAggregate);

      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 10 }],
      };

      const result = await upsertReport(input);

      expect(result._action).toBe('updated');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('should reject update after edit window expires', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2); // 2 days ago

      const existingAggregate = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-03',
      });
      // Сдан двое суток назад, а правили только что. Раньше окно считалось от
      // последней правки и продлевалось с каждым сохранением — отчёт правился
      // бессрочно. Теперь оно отсчитывается от сдачи.
      mockDb.report.findUnique.mockResolvedValueOnce({ submittedAt: oldDate, shift: null });

      mockRepoFindById.mockResolvedValue(existingAggregate);

      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-03',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
      };

      await expect(upsertReport(input, { enforceEditWindow: true })).rejects.toThrow(
        'Окно редактирования истекло'
      );
      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('should allow update when edit window is disabled', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2);

      const existingAggregate = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-03',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      (existingAggregate as any).state.updatedAt = oldDate.toISOString();

      mockRepoFindById.mockResolvedValue(existingAggregate);

      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-03',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
      };

      const result = await upsertReport(input, { enforceEditWindow: false });

      expect(result._action).toBe('updated');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('business rules', () => {
    it('should reject negative pile count', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: -1 }],
      };

      await expect(upsertReport(input)).rejects.toThrow();
    });

    it('should reject excessive pile count', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 10000 }],
      };

      await expect(upsertReport(input)).rejects.toThrow();
    });

    it('should reject negative downtime duration', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 1 }],
        downtimes: [{ reasonId: 'reason-1', duration: -10 }],
      };

      await expect(upsertReport(input)).rejects.toThrow();
    });

    it('should reject negative drilling meters', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        drillings: [{ typeId: 'type-1', count: 1, metersPerUnit: 10, meters: -5 }],
      };

      await expect(upsertReport(input)).rejects.toThrow();
    });
  });

  describe('authorization', () => {
    it('should resolve user ID correctly', () => {
      const sessionUser = { id: 'admin-1', role: 'ADMIN' };
      const resolved = resolveReportUserId(sessionUser, 'user-2');
      expect(resolved).toBe('user-2');
    });

    it('should default to session user when no requested user', () => {
      const sessionUser = { id: 'user-1', role: 'OPERATOR' };
      const resolved = resolveReportUserId(sessionUser, null);
      expect(resolved).toBe('user-1');
    });

    it('should not throw for valid user scope', () => {
      const sessionUser = { id: 'admin-1', role: 'ADMIN' };
      expect(() => assertCanActForUser(sessionUser, 'user-2')).not.toThrow();
    });

    /*
      Правка чужого отчёта по его идентификатору.

      Маршрут проверяет право действовать за ПРИСЛАННОГО пользователя, а
      команда грузила запись по одному reportId. Оператор, приславший свой
      собственный userId и чужой reportId, проходил проверку прав и переписывал
      выработку в чужом отчёте: владелец в записи оставался прежним, а сваи
      становились его. Изоляция по организации здесь не помогает — оба внутри
      одной.
    */
    it('отказывает в правке отчёта, принадлежащего другому пользователю', async () => {
      const victimsReport = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'victim',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      victimsReport.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'victim');
      mockRepoFindById.mockResolvedValue(victimsReport);

      await expect(upsertReport({
        reportId: 'report-1',
        // Нападающий действует от себя — право действовать за себя есть у всех.
        userId: 'attacker',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 99 }],
      })).rejects.toThrow(/другому пользователю/);

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('правку своего отчёта не трогает', async () => {
      const own = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      own.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      mockRepoFindById.mockResolvedValue(own);

      await upsertReport({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 7 }],
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    /*
      Вторая линия той же проверки — организация. Владельца сверяет тест выше,
      но у отчёта чужого тенанта владелец может совпасть (один и тот же человек
      заведён в двух организациях), и тогда держит только это условие.

      Строгое равенство требуется лишь когда организация проставлена в самой
      записи: у отчётов, заведённых до появления тенанта, там пусто, и отказ в
      их правке был бы поломкой, а не защитой. Оба случая ниже — чтобы
      «ужесточение» этого послабления не прошло молча.
    */
    it('отказывает в правке отчёта другой организации', async () => {
      const foreign = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        tenantId: 'tenant-b',
        date: '2026-04-05',
      });
      foreign.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      mockRepoFindById.mockResolvedValue(foreign);

      await expect(upsertReport({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        tenantId: 'tenant-a',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 99 }],
      })).rejects.toThrow(/другой организации/);

      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    it('правку своего отчёта без организации в записи разрешает', async () => {
      const legacy = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      legacy.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      mockRepoFindById.mockResolvedValue(legacy);

      await upsertReport({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        tenantId: 'tenant-a',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 7 }],
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    /*
      Номер отчёта приходит с формы, а дату и объект найденная запись держит
      свои. Форма, не сбросившая номер при смене даты, отправляла «отчёт за
      вчера», сервер отвечал 200 и переписывал сегодняшний. Воспроизведено
      вживую 23.09.2026.
    */
    it.each([
      ['дата', { date: '2026-04-04' }],
      ['объект', { siteId: 'site-2' }],
    ])('отказывает, когда %s не совпадает с найденным отчётом', async (_label, change) => {
      const stored = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      stored.addPileWork({ pileGradeId: 'grade-1', count: 1 }, 'user-1');
      mockRepoFindById.mockResolvedValue(stored);

      await expect(upsertReport({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 3 }],
        ...change,
      })).rejects.toThrow(/другую дату или другой объект/);

      expect(mockRepoSave).not.toHaveBeenCalled();
    });
  });

  describe('tenant + concurrency wiring', () => {
    it('persists tenantId from the command onto the created aggregate', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-tenant',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        tenantId: 'orion',
        piles: [{ pileGradeId: 'grade-1', count: 2 }],
      };

      await upsertReport(input);

      const savedAggregate = mockRepoSave.mock.calls[0][0] as ReportAggregate;
      expect(savedAggregate.getState().tenantId).toBe('orion');
    });

    it('forwards expectedVersion to the repository save options', async () => {
      const input: UpsertReportCommand = {
        reportId: 'report-v',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        expectedVersion: 7,
        piles: [{ pileGradeId: 'grade-1', count: 1 }],
      };

      await upsertReport(input);

      expect(mockRepoSave).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ expectedVersion: 7 }),
      );
    });
  });
});
