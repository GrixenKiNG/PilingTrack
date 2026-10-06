import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Сводка «ТБ и допуски» — единственный расчёт, по которому инженер ОТ видит,
 * кто допущен к работе сегодня. Своего хранилища у модуля нет: числа собираются
 * из чужих таблиц и чистых функций, поэтому ошибка здесь не падает, а тихо
 * показывает неверный допуск.
 *
 * Проверяем то, чем дороже всего ошибиться:
 *  - границы «сегодня» по московским суткам: контейнер живёт в UTC, и наивные
 *    сутки сдвинули бы ночные инструктажи в чужой день;
 *  - срок действия проверки знаний — граница «истёк ровно сейчас»;
 *  - просроченный повторный инструктаж и «ожидают ознакомления» — разные вещи,
 *    и свести их в одно число значит потерять одну из двух проблем.
 */

const {
  requiredTypesFindMany, usersFindMany, documentsFindMany,
  briefingsFindMany, briefingsGroupBy, incidentsCount, evaluateClearance,
} = vi.hoisted(() => ({
  requiredTypesFindMany: vi.fn(),
  usersFindMany: vi.fn(),
  documentsFindMany: vi.fn(),
  briefingsFindMany: vi.fn(),
  briefingsGroupBy: vi.fn(),
  incidentsCount: vi.fn(),
  evaluateClearance: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    userDocumentType: { findMany: requiredTypesFindMany },
    user: { findMany: usersFindMany },
    userDocument: { findMany: documentsFindMany },
    briefingRecord: { findMany: briefingsFindMany, groupBy: briefingsGroupBy },
    safetyIncident: { count: incidentsCount },
  },
}));

vi.mock('@/modules/users', () => ({
  evaluateOperatorClearance: evaluateClearance,
}));

import { querySafetyClearanceOverview } from '../application/clearance-overview-query';

/** 15.09.2026 00:30 МСК — ночь, где UTC-сутки и московские расходятся. */
const NOW = new Date('2026-09-14T21:30:00.000Z');

const clearance = (over: Record<string, unknown> = {}) => ({
  cleared: true, blockers: [], warnings: [], documents: [], ...over,
});

const overview = (patch: Record<string, unknown> = {}) =>
  querySafetyClearanceOverview({
    tenantId: 'orion', mayReadAllDocuments: true, now: NOW, ...patch,
  } as Parameters<typeof querySafetyClearanceOverview>[0]);

beforeEach(() => {
  vi.resetAllMocks();
  requiredTypesFindMany.mockResolvedValue([{ id: 'dt-med', name: 'Медосмотр', leadTimeDays: 30 }]);
  usersFindMany.mockResolvedValue([{ id: 'u1', name: 'Иванов', role: 'OPERATOR' }]);
  documentsFindMany.mockResolvedValue([]);
  briefingsFindMany.mockResolvedValue([]);
  briefingsGroupBy.mockResolvedValue([]);
  incidentsCount.mockResolvedValue(0);
  evaluateClearance.mockReturnValue(clearance());
});

describe('Допуск к работе: права и организация', () => {
  it('отказывает без права читать документы всех', async () => {
    await expect(overview({ mayReadAllDocuments: false }))
      .rejects.toThrow('Недостаточно прав для просмотра допусков');
    expect(usersFindMany).not.toHaveBeenCalled();
  });

  it('отказывает без организации, а не отдаёт всех', async () => {
    await expect(overview({ tenantId: '' })).rejects.toThrow('tenantId is required');
    expect(usersFindMany).not.toHaveBeenCalled();
  });
});

describe('Границы суток: «сегодня» — московские сутки, а не UTC', () => {
  /**
   * now = 15.09 00:30 МСК. Московский день начинается в 21:00Z предыдущего
   * числа. Если бы границы резались по UTC, окно «сегодня» начиналось бы в
   * 00:00Z, и инструктаж, проведённый ночью в 00:30 МСК, попал бы в чужой день.
   */
  it('считает «Журнал за сегодня» по московской полуночи', async () => {
    briefingsGroupBy.mockResolvedValue([{ type: 'REPEAT', _count: { _all: 2 } }]);

    const result = await overview();

    const where = briefingsGroupBy.mock.calls[0][0].where;
    expect(where.kind).toBe('INSTRUCTION');
    expect((where.recordedAt.gte as Date).toISOString()).toBe('2026-09-14T21:00:00.000Z');
    expect((where.recordedAt.lt as Date).toISOString()).toBe('2026-09-15T21:00:00.000Z');

    // Все пять видов присутствуют всегда: «Внеплановый 0» — это ответ.
    expect(result.todayByType.REPEAT).toBe(2);
    expect(result.todayByType.INDUCTION).toBe(0);
    expect(result.todayByType.TARGETED).toBe(0);
  });
});

describe('Проверка знаний: срок действия', () => {
  const knowledge = (validUntil: Date | null) => ({
    userId: 'u1', kind: 'KNOWLEDGE', recordedAt: NOW,
    validUntil, correct: 27, total: 30,
  });

  it('не сдавал — «never», а не «просрочена»', async () => {
    const result = await overview();
    expect(result.rows[0].knowledge.status).toBe('never');
    expect(result.rows[0].knowledge.result).toBeNull();
    expect(result.totals.knowledgeOverdue).toBe(1);
  });

  it('истёк ровно в момент проверки ещё действует', async () => {
    briefingsFindMany.mockResolvedValueOnce([knowledge(new Date(NOW.getTime()))]);
    const result = await overview();
    expect(result.rows[0].knowledge.status).toBe('valid');
    expect(result.totals.knowledgeOverdue).toBe(0);
  });

  it('миллисекунда просрочки — уже «expired»', async () => {
    briefingsFindMany.mockResolvedValueOnce([knowledge(new Date(NOW.getTime() - 1))]);
    const result = await overview();
    expect(result.rows[0].knowledge.status).toBe('expired');
    expect(result.totals.knowledgeOverdue).toBe(1);
  });

  it('проверка без срока считается действующей', async () => {
    briefingsFindMany.mockResolvedValueOnce([knowledge(null)]);
    const result = await overview();
    expect(result.rows[0].knowledge.status).toBe('valid');
    expect(result.rows[0].knowledge.result).toBe('27 из 30');
  });
});

describe('Инструктажи: ознакомление и просроченный повторный', () => {
  it('не проходил ни разу — «ожидает ознакомления», без просрочки', async () => {
    const result = await overview();
    const row = result.rows[0];
    expect(row.acquainted).toBe(false);
    expect(row.pendingInstructions).toEqual(['Не ознакомлен: Безопасность при свайных работах']);
    expect(row.overdueBriefings).toEqual([]);
    expect(result.totals.awaitingAcquaintance).toBe(1);
    expect(result.totals.briefingsOverdue).toBe(0);
  });

  it('ознакомлен с действующей редакцией, но повторный просрочен', async () => {
    // Первый вызов — последние записи на человека, второй — вся история
    // ознакомлений, по которой и считаются требования.
    briefingsFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { userId: 'u1', documentCode: 'И-СМ-04', documentVersion: '1.0', recordedAt: new Date('2025-09-14T21:30:00.000Z') },
      ]);
    const result = await overview();
    const row = result.rows[0];
    expect(row.acquainted).toBe(true);
    expect(row.pendingInstructions).toEqual([]);
    expect(row.overdueBriefings[0]).toMatch(
      /^Просрочен повторный инструктаж: Безопасность при свайных работах — \d+ дн\.$/,
    );
    expect(result.totals.briefingsOverdue).toBe(1);
    expect(result.totals.awaitingAcquaintance).toBe(0);
  });

  it('роль без обязательных инструкций числится ознакомленной', async () => {
    usersFindMany.mockResolvedValue([{ id: 'u1', name: 'Петров', role: 'MECHANIC' }]);
    const result = await overview();
    expect(result.rows[0].acquainted).toBe(true);
    expect(result.totals.awaitingAcquaintance).toBe(0);
  });
});

describe('Документы и итоги', () => {
  it('допуск и препятствия берутся из расчёта, а не считаются заново', async () => {
    evaluateClearance.mockReturnValue(clearance({
      cleared: false,
      blockers: [{ typeId: 'dt-med', typeName: 'Медосмотр', reason: 'expired', daysLeft: -12, label: 'Просрочен: Медосмотр — 12 дней' }],
    }));
    const result = await overview();
    expect(result.rows[0].cleared).toBe(false);
    expect(result.rows[0].blockers).toEqual(['Просрочен: Медосмотр — 12 дней']);
    expect(result.totals.cleared).toBe(0);
    expect(result.totals.blocked).toBe(1);
  });

  it('ближайший срок — самый ранний из документов', async () => {
    evaluateClearance.mockReturnValue(clearance({
      documents: [
        { typeId: 'a', expiresAt: '2026-10-01T00:00:00.000Z' },
        { typeId: 'b', expiresAt: '2026-09-20T00:00:00.000Z' },
        { typeId: 'c', expiresAt: null },
      ],
    }));
    const result = await overview();
    expect(result.rows[0].nextExpiryAt).toBe('2026-09-20T00:00:00.000Z');
  });

  /**
   * Пустой список обязательных видов — не «все допущены», а «допуск не
   * проверяется ничем». Экран обязан сказать это вслух, иначе зелёные цифры
   * врут.
   */
  it('без обязательных видов документов заявляет, что допуск не проверяется', async () => {
    requiredTypesFindMany.mockResolvedValue([]);
    const result = await overview();
    expect(result.requiredTypesConfigured).toBe(false);
    expect(documentsFindMany).not.toHaveBeenCalled();
  });

  it('считает происшествия за 30 и предыдущие 30 дней раздельно', async () => {
    incidentsCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    const result = await overview();
    expect(result.incidents).toEqual({ last30: 3, previous30: 1 });
  });
});
