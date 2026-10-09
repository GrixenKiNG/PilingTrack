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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReportAggregate } from '../../../domain';
import type { ReportRepository } from '../../../infrastructure';
import { upsertReport, assertCanActForUser, resolveReportUserId } from '../report-command.service';
import type { UpsertReportCommand } from '../upsert-report.command';
import { ServiceError } from '@/lib/service-error';

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

// Клиент транзакции. Тот же объект, что и db: команда передаёт его в
// репозиторий и читает им же, поэтому тесты читающих методов не меняются.
const mockTx = {
  // Фазы 2–5 команды идут одной транзакцией (F-R38-1): замок берётся её
  // первым оператором, чтение и запись — тем же клиентом.
  $executeRaw: vi.fn().mockResolvedValue(1),
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

const mockDb = {
  ...mockTx,
  $transaction: (cb: (tx: typeof mockTx) => unknown) => cb(mockTx),
};

vi.mock('@/lib/db', () => ({
  DEFAULT_TX_OPTIONS: {},
  get db() { return mockDb; },
}));

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

// Mock repository
const mockRepoSave = vi.fn().mockResolvedValue(undefined);
const mockRepoFindById = vi.fn().mockResolvedValue(null);
const mockRepoFindByNaturalKey = vi.fn().mockResolvedValue(null);

const mockRepo: ReportRepository = {
  save: mockRepoSave,
  findById: mockRepoFindById,
  findByUserIdAndDate: mockRepoFindByNaturalKey,
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
    it('X5: requires the version the client actually edited', async () => {
      mockRepoFindById.mockResolvedValue(ReportAggregate.create({ reportId: 'report-1', userId: 'user-1', siteId: 'site-1', date: '2026-04-05' }));
      await expect(upsertReport({ reportId: 'report-1', userId: 'user-1', siteId: 'site-1', date: '2026-04-05', piles: [{ pileGradeId: 'grade-1', count: 2 }] }))
        .rejects.toMatchObject({ status: 400 });
      expect(mockRepoSave).not.toHaveBeenCalled();
    });
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
        expectedVersion: existingAggregate.getState().version,
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
        expectedVersion: existingAggregate.getState().version,
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
        expectedVersion: existingAggregate.getState().version,
      };

      const result = await upsertReport(input, { enforceEditWindow: false });

      expect(result._action).toBe('updated');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });
  });

  /*
    Границы окна правки отчёта (F-29).

    Окно объявлено константой EDIT_WINDOW_HOURS = 24 в
    report-command.service.ts и отсчитывается от СДАЧИ отчёта
    (`submittedAt`, для отчёта из формы — от создания). До сих пор тестами
    был закрыт только грубый случай «сдано двое суток назад»; ни одна из
    границ не закреплена.

    Системное время подменяем: иначе тест зависел бы от момента запуска.
    Время начала окна задаём в самой записи, а не через createdAt агрегата,
    — как это и делает сервер.
  */
  describe('окно правки отчёта — границы (F-29)', () => {
    const HOUR_MS = 60 * 60 * 1000;
    // 12:00 UTC = 15:00 МСК — дата отчёта считается «сегодняшней» в любом
    // рабочем часовом поясе, поэтому валидация «не в будущем» не мешает.
    const NOW = new Date('2026-04-05T12:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Правка своего отчёта за 2026-04-05, сданного `msAgo` мс назад. */
    function editOfReportSubmitted(msAgo: number): UpsertReportCommand {
      const existingAggregate = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      existingAggregate.addPileWork({ pileGradeId: 'grade-1', count: 3 }, 'user-1');
      mockRepoFindById.mockResolvedValue(existingAggregate);
      mockDb.report.findUnique.mockResolvedValueOnce({
        submittedAt: new Date(NOW.getTime() - msAgo),
      });

      return {
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 5 }],
        expectedVersion: existingAggregate.getState().version,
      };
    }

    it('через 23 ч 59 мин правка ещё разрешена', async () => {
      const result = await upsertReport(
        editOfReportSubmitted(24 * HOUR_MS - 60 * 1000),
        { enforceEditWindow: true },
      );

      expect(result._action).toBe('updated');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    it('через 24 ч 1 мин — отказ 403 с понятной русской ошибкой', async () => {
      const error = await upsertReport(
        editOfReportSubmitted(24 * HOUR_MS + 60 * 1000),
        { enforceEditWindow: true },
      ).then(
        () => null,
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(403);
      expect((error as ServiceError).message).toMatch(/Окно редактирования истекло/);
      // Оператор должен понять, как исправить: отчёт сдан N ч назад и правка
      // возможна через администратора.
      expect((error as ServiceError).message).toContain('24 ч назад');
      expect((error as ServiceError).message).toContain('администратора');
      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    /*
      Ровно 24 ч — правка ЕЩЁ проходит: условие в коде строгое
      (`elapsedHours > EDIT_WINDOW_HOURS`). Это зафиксировано как фактическое
      поведение, а не как желаемое: независимый аудит (F-29) ожидал отказа на
      самой границе. Код проверки не меняем — тест фиксирует текущее правило,
      чтобы будущая правка границы не прошла молча.
    */
    it('ровно через 24 ч правка ещё проходит (граница строгая, > 24)', async () => {
      const result = await upsertReport(
        editOfReportSubmitted(24 * HOUR_MS),
        { enforceEditWindow: true },
      );

      expect(result._action).toBe('updated');
      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    /*
      Отчёт без отметки сдачи (созданный формой) — окно считается от создания,
      а не от последней правки. Иначе каждое сохранение продлевало бы окно.
    */
    it('без отметки сдачи окно отсчитывается от создания отчёта', async () => {
      vi.setSystemTime(new Date(NOW.getTime() - 25 * HOUR_MS));
      const existingAggregate = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
      });
      existingAggregate.addPileWork({ pileGradeId: 'grade-1', count: 3 }, 'user-1');
      vi.setSystemTime(NOW);

      mockRepoFindById.mockResolvedValue(existingAggregate);
      mockDb.report.findUnique.mockResolvedValueOnce({ submittedAt: null });

      const error = await upsertReport(
        {
          reportId: 'report-1',
          userId: 'user-1',
          siteId: 'site-1',
          date: '2026-04-05',
          piles: [{ pileGradeId: 'grade-1', count: 5 }],
          expectedVersion: existingAggregate.getState().version,
        },
        { enforceEditWindow: true },
      ).then(
        () => null,
        (e: unknown) => e,
      );

      expect((error as ServiceError)?.status).toBe(403);
      expect(mockRepoSave).not.toHaveBeenCalled();
    });

    /*
      Особое правило роли в коде одно: маршрут админской правки
      (src/app/api/reports/admin-upsert/route.ts) вызывает команду с
      enforceEditWindow: false — администратор окном не ограничен. Операторский
      маршрут (upsert/route.ts) всегда передаёт true, добавленной роли в самой
      команде нет.
    */
    it('админскому пути окно не мешает (admin-upsert передаёт enforceEditWindow: false)', async () => {
      const result = await upsertReport(
        editOfReportSubmitted(5 * 24 * HOUR_MS),
        { enforceEditWindow: false, actor: { id: 'admin-1', name: 'Админ', role: 'ADMIN' } },
      );

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
        expectedVersion: own.getState().version,
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
        expectedVersion: legacy.getState().version,
      });

      expect(mockRepoSave).toHaveBeenCalledTimes(1);
    });

    /*
      Отсутствие организации у ПРАВЯЩЕГО послаблением не было: условие
      добавлялось только когда `input.tenantId` проставлен, поэтому запрос без
      организации проходил мимо тенантной проверки и правил отчёт чужой
      организации. Организация приходит из сессии (`requireTenantId` в
      маршруте), так что её отсутствие — отказ.
    */
    it('отказывает в правке отчёта с организацией, когда организация не определена у правящего', async () => {
      const foreign = ReportAggregate.create({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        tenantId: 'tenant-a',
        date: '2026-04-05',
      });
      foreign.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      mockRepoFindById.mockResolvedValue(foreign);

      await expect(upsertReport({
        reportId: 'report-1',
        userId: 'user-1',
        siteId: 'site-1',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 99 }],
      })).rejects.toThrow(/Организация/);

      expect(mockRepoSave).not.toHaveBeenCalled();
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
        // Третьим аргументом идёт клиент транзакции команды (F-R38-1).
        expect.anything(),
      );
    });
  });

  /*
    Гонка двух отправок без reportId (F-R38-1).

    Маршрут генерирует новый reportId на каждый запрос, поэтому повторная
    отправка (потерян ответ, перепосылка из очереди телефона) приходит с
    неизвестным идентификатором и попадает на поиск по естественному ключу
    «машинист + объект + день». Раньше поиск и вставка шли врозь: обе отправки
    успевали прочитать «отчёта нет» и обе создавали строку — два отчёта за одну
    смену одного человека, и выработка задваивалась в аналитике и в дневной
    сводке объекта.
  */
  describe('advisory-замок по естественному ключу отчёта (F-R38-1)', () => {
    it('берёт замок раньше поиска по машинисту, объекту и дате, и пишет тем же клиентом', async () => {
      const order: string[] = [];
      mockTx.$executeRaw.mockImplementation(async () => { order.push('lock'); });
      mockRepoFindByNaturalKey.mockImplementation(async () => { order.push('lookup'); return null; });
      mockRepoSave.mockImplementation(async () => { order.push('save'); });

      await upsertReport({
        reportId: 'report-race',
        userId: 'user-1',
        siteId: 'site-1',
        tenantId: 'orion',
        date: '2026-04-05',
        piles: [{ pileGradeId: 'grade-1', count: 1 }],
      });

      // Замок — первый оператор транзакции, до чтения. $queryRaw для него не
      // годится: pg_advisory_xact_lock возвращает void и колонка не
      // десериализуется.
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      const call = mockTx.$executeRaw.mock.calls[0];
      expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
      expect(call.slice(1)).toEqual(['report:orion:user-1:site-1:2026-04-05']);

      // Чтение «есть ли отчёт» и запись — под тем же замком и той же
      // транзакцией: иначе замок не мешает второй отправке создать дубль.
      expect(order).toEqual(['lock', 'lookup', 'save']);
      expect(mockRepoSave.mock.calls[0][2]).toBe(mockTx);
    });
  });
});
