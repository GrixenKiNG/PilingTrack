/**
 * upsertReport — отказ посткоммитного аудита не должен ломать ответ (находка Codex XP37).
 *
 * После коммита отчёт уже сохранён, а аудит в журнал и ленту — побочное
 * действие. Код сам заявляет: если оно упало, отчёт всё равно сохранён. Но
 * ошибка уходила пользователю как ошибка сохранения, хотя данные записаны.
 * Теперь она пишется в журнал, а команда возвращает сохранённый отчёт.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const aggregate = {
    getState: vi.fn(),
    getPendingEvents: vi.fn(),
    updateShiftInfo: vi.fn(),
    addPileWork: vi.fn(),
    addDrilling: vi.fn(),
    addDowntime: vi.fn(),
    submit: vi.fn(),
  };

  return {
    aggregate,
    create: vi.fn(),
    findById: vi.fn(),
    findByUserIdAndDate: vi.fn(),
    save: vi.fn(),
    transaction: vi.fn(),
    readReport: vi.fn(),
    executeRaw: vi.fn(),
    crews: vi.fn(),
    shift: vi.fn(),
    writeAudit: vi.fn(),
    postAudit: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: mocks.transaction,
    report: { findUnique: mocks.readReport },
  },
  DEFAULT_TX_OPTIONS: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.logError },
}));

vi.mock('@/core/security/resource-access', () => ({
  assertReportOwnerOnSite: vi.fn(),
  resolveAccessibleUserId: vi.fn(),
  assertCanManageUserScope: vi.fn(),
}));

vi.mock('../../../domain', () => ({
  ReportAggregate: {
    create: mocks.create,
    reconstitute: vi.fn(),
  },
}));

vi.mock('../../../infrastructure', () => ({
  getReportRepository: () => ({
    findById: mocks.findById,
    findByUserIdAndDate: mocks.findByUserIdAndDate,
    save: mocks.save,
  }),
}));

vi.mock('../report-validation.service', () => ({
  validateReportInput: vi.fn(),
  validatePicketsBelongToSite: vi.fn(),
  validateAgainstSitePlans: vi.fn(),
}));

vi.mock('../../audit-service', () => ({
  writeReportAuditRow: mocks.writeAudit,
  recordPostCommitAuditEvent: mocks.postAudit,
  computeDiff: vi.fn(),
}));

import { upsertReport } from '../report-command.service';

const tx = {
  $executeRaw: mocks.executeRaw,
  report: { findUnique: mocks.readReport },
  crew: { findMany: mocks.crews },
  shift: { findFirst: mocks.shift },
};

type TestTx = typeof tx;

// Внешняя валидация и домен замоканы: тест изолирует границу коммита.
function command() {
  return {
    reportId: 'report-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    siteId: 'site-1',
    date: '2026-10-19',
    shiftType: 'DAY',
    shiftStart: '08:00',
    shiftEnd: '20:00',
    piles: [],
    drillings: [],
    downtimes: [],
  } as Parameters<typeof upsertReport>[0];
}

let committed = false;

beforeEach(() => {
  vi.resetAllMocks();
  committed = false;

  mocks.findById.mockResolvedValue(null);
  mocks.findByUserIdAndDate.mockResolvedValue(null);
  mocks.crews.mockResolvedValue([]);
  mocks.executeRaw.mockResolvedValue(1);

  mocks.create.mockReturnValue(mocks.aggregate);
  mocks.aggregate.getState.mockReturnValue({
    reportId: 'report-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    siteId: 'site-1',
    date: '2026-10-19',
  });
  mocks.aggregate.getPendingEvents.mockReturnValue([]);

  mocks.writeAudit.mockResolvedValue(undefined);
  mocks.postAudit.mockResolvedValue(undefined);

  mocks.save.mockImplementation(
    async (
      _aggregate: unknown,
      options: {
        onBeforeCommit: (saveTx: TestTx) => Promise<void>;
      },
      saveTx: TestTx,
    ) => {
      await options.onBeforeCommit(saveTx);
    },
  );

  mocks.transaction.mockImplementation(
    async (work: (client: TestTx) => Promise<unknown>) => {
      const result = await work(tx);
      // Коммит возможен только после успешного callback.
      committed = true;
      return result;
    },
  );
});

it('возвращает сохранённый отчёт при отклонении посткоммитного аудита',
  async () => {
    const report = { reportId: 'report-1' };
    const error = new Error('post-commit audit unavailable');
    mocks.readReport.mockResolvedValue(report);
    mocks.postAudit.mockRejectedValue(error);

    await expect(
      upsertReport(command(), { enforceEditWindow: false }),
    ).resolves.toEqual({
      report,
      events: [],
      _action: 'created',
    });

    expect(committed).toBe(true);
    expect(mocks.logError).toHaveBeenCalledWith(
      'Посткоммитный аудит отчёта не выполнен',
      expect.objectContaining({
        reportId: 'report-1',
        error,
      }),
    );
  },
);
