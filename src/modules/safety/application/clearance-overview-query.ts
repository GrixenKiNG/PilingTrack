/**
 * Сводка «ТБ и допуски»: кто из работников допущен к работе сегодня.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ВЫБОРКА. Данные охраны труда в системе уже есть, но каждая
 * половина отвечает на свой вопрос и ни одна — на главный. «Документы»
 * (`/api/user-documents/control`) перечисляют просроченные БУМАГИ, а не людей:
 * у работника с тремя просрочками три строки, у благополучного — ни одной, и
 * «сколько человек допущено» из такого списка не сложить. «Инструктажи»
 * (`/api/briefings/journal`) показывают историю за период — что БЫЛО, а не что
 * есть сейчас. Инженеру ОТ утром нужен третий разрез: строка на человека и
 * итог «допущены N из M».
 *
 * СВОИХ ТАБЛИЦ У МОДУЛЯ НЕТ И НЕ ДОЛЖНО БЫТЬ. Всё читается из чужих: допуск
 * считает `evaluateOperatorClearance` — та же чистая функция, которой
 * пользуются экран оператора и серверная команда пуска смены. Считать здесь
 * своё второе мнение нельзя: разойдясь, экран ОТ показывал бы «допущен», а
 * пуск смены отвечал бы отказом.
 *
 * ПРОВЕРКА ЗНАНИЙ НЕ ВХОДИТ В ДОПУСК — и это не упущение. Допуск к смене
 * держат обязательные документы (`UserDocumentType.requiredForOperator`) и
 * блокировки контура готовности; `BriefingRecord` не участвует в расчёте
 * нигде. Показываем её ОТДЕЛЬНОЙ колонкой, а не подмешиваем в `cleared`:
 * иначе эта сводка начала бы противоречить экрану оператора — ровно тот
 * разъезд двух систем прав, который проект уже проходил.
 *
 * ПРАВО ПРИХОДИТ АРГУМЕНТОМ. Прикладная матрица прав живёт в `services/auth`,
 * и модулям запрещено от неё зависеть (проверяет линтер). Решение принимает
 * маршрут — тот же приём, что в журнале инструктажей.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { evaluateOperatorClearance } from '@/modules/users';
import type { BriefingType } from '@/generated/postgres-client/client';

/**
 * Чей допуск вообще имеет смысл считать.
 *
 * Обязательные документы заводятся под работу на площадке: удостоверение
 * машиниста, медосмотр, охрана труда. У администратора и диспетчера их нет и
 * не будет, и строка «нет допуска» на них — не находка, а шум, в котором
 * тонут настоящие. Инженер ОТ на площадку выходит, поэтому он в списке.
 */
const FIELD_ROLES = ['OPERATOR', 'ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER'];

/** Что показываем про проверку знаний по ТБ. */
export type KnowledgeStatus =
  /** Сдана и действует. */
  | 'valid'
  /** Срок действия вышел. */
  | 'expired'
  /** Не сдавал ни разу. */
  | 'never';

export interface SafetyClearanceRow {
  userId: string;
  name: string;
  role: string;
  /** Допущен по документам. Проверка знаний сюда НЕ входит — см. шапку файла. */
  cleared: boolean;
  /** Что мешает работать, готовыми строками: «Просрочен: медосмотр — 12 дней». */
  blockers: string[];
  /** Что скоро помешает. Допуску не мешает. */
  warnings: string[];
  /** Ближайший срок среди обязательных документов, ISO. null — сроков нет. */
  nextExpiryAt: string | null;
  knowledge: {
    status: KnowledgeStatus;
    validUntil: string | null;
    /** «27 из 30» — как в журнале. null, если не сдавал. */
    result: string | null;
  };
  /** Когда последний раз знакомился с инструкцией. null — никогда. */
  lastInstructionAt: string | null;
}

/** Сколько инструктажей каждого вида провели за сегодня. */
export type TodayBriefingCounts = Record<BriefingType, number>;

export interface SafetyClearanceOverview {
  rows: SafetyClearanceRow[];
  /** Счётчики сводки «Журнал за сегодня». Ноль — это факт, а не пустота. */
  todayByType: TodayBriefingCounts;
  /**
   * Происшествия за последние 30 дней и за предыдущие 30 — плитка показывает
   * не только число, но и куда оно движется. Одно число без сравнения не
   * говорит, стало хуже или лучше.
   */
  incidents: { last30: number; previous30: number };
  totals: {
    people: number;
    cleared: number;
    blocked: number;
    /** У скольких человек хоть один документ истекает в окне предупреждения. */
    expiring: number;
    /** У скольких проверка знаний просрочена или не сдавалась. */
    knowledgeOverdue: number;
  };
  /**
   * Заведён ли хоть один обязательный вид документа.
   *
   * false означает, что допуск не проверяется НИЧЕМ, и все до одного
   * «допущены» — формально верно и полностью бессмысленно. Экран обязан
   * сказать это вслух: зелёное «допущены 39 из 39» на непроверенных людях —
   * худшая ошибка, какую эта сводка может совершить.
   */
  requiredTypesConfigured: boolean;
}

export async function querySafetyClearanceOverview(input: {
  tenantId: string;
  /** `users.documents.read_all` у того, кто спрашивает. Считает маршрут. */
  mayReadAllDocuments: boolean;
  now?: Date;
}): Promise<SafetyClearanceOverview> {
  if (!input.mayReadAllDocuments) {
    throw new ServiceError('Недостаточно прав для просмотра допусков', 403);
  }
  // Без организации выборка не сужается ничем: отказ здесь правилен, а пустой
  // или полный список одинаково неверны.
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const now = input.now ?? new Date();
  const tenantId = input.tenantId;

  const [requiredTypes, users] = await Promise.all([
    db.userDocumentType.findMany({
      where: { tenantId, isActive: true, requiredForOperator: true },
      select: { id: true, name: true, leadTimeDays: true },
    }),
    db.user.findMany({
      where: { tenantId, isActive: true, role: { in: FIELD_ROLES } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 3600 * 1000);

  const userIds = users.map((user) => user.id);
  const [documents, briefings] = await Promise.all([
    requiredTypes.length === 0 || userIds.length === 0
      ? Promise.resolve([])
      : db.userDocument.findMany({
          where: {
            tenantId,
            userId: { in: userIds },
            typeId: { in: requiredTypes.map((type) => type.id) },
          },
          select: { userId: true, typeId: true, expiresAt: true },
        }),
    userIds.length === 0
      ? Promise.resolve([])
      : // Последняя запись каждого вида на человека. `distinct` поверх
        // сортировки по убыванию даёт именно её — иначе пришлось бы тянуть
        // весь журнал за все годы и сворачивать в памяти.
        db.briefingRecord.findMany({
          where: { tenantId, userId: { in: userIds } },
          select: {
            userId: true, kind: true, recordedAt: true,
            validUntil: true, correct: true, total: true,
          },
          orderBy: { recordedAt: 'desc' },
          distinct: ['userId', 'kind'],
        }),
  ]);

  const [todayGroups, incidentsLast30, incidentsPrevious30] = await Promise.all([
    db.briefingRecord.groupBy({
      by: ['type'],
      where: {
        tenantId,
        kind: 'INSTRUCTION',
        recordedAt: { gte: startOfToday, lt: endOfToday },
      },
      _count: { _all: true },
    }),
    db.safetyIncident.count({ where: { tenantId, occurredAt: { gte: monthAgo } } }),
    db.safetyIncident.count({
      where: { tenantId, occurredAt: { gte: twoMonthsAgo, lt: monthAgo } },
    }),
  ]);

  // Все пять видов присутствуют всегда, даже нулями: «Внеплановый 0» — это
  // ответ, а исчезнувшая строка читается как «не считали».
  const todayByType: TodayBriefingCounts = {
    INDUCTION: 0, PRIMARY: 0, REPEAT: 0, UNSCHEDULED: 0, TARGETED: 0,
  };
  for (const group of todayGroups) {
    if (group.type) todayByType[group.type] = group._count._all;
  }

  const documentsByUser = new Map<string, Array<{ typeId: string; expiresAt: Date | null }>>();
  for (const document of documents) {
    const own = documentsByUser.get(document.userId);
    if (own) own.push(document);
    else documentsByUser.set(document.userId, [document]);
  }

  const knowledgeByUser = new Map<string, (typeof briefings)[number]>();
  const instructionByUser = new Map<string, (typeof briefings)[number]>();
  for (const record of briefings) {
    if (record.kind === 'KNOWLEDGE') knowledgeByUser.set(record.userId, record);
    else instructionByUser.set(record.userId, record);
  }

  const rows: SafetyClearanceRow[] = users.map((user) => {
    const held = documentsByUser.get(user.id) ?? [];
    const clearance = evaluateOperatorClearance(requiredTypes, held, now);

    const expiryTimes = clearance.documents
      .map((document) => document.expiresAt)
      .filter((value): value is string => value != null)
      .map((value) => new Date(value).getTime())
      .filter((time) => !Number.isNaN(time));

    const knowledge = knowledgeByUser.get(user.id);
    const knowledgeStatus: KnowledgeStatus = !knowledge
      ? 'never'
      // Проверка знаний без срока действия считается действующей: срок ставит
      // тот, кто её проводит, и его отсутствие — не повод объявить человека
      // непроверенным.
      : knowledge.validUntil != null && knowledge.validUntil.getTime() < now.getTime()
        ? 'expired'
        : 'valid';

    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      cleared: clearance.cleared,
      blockers: clearance.blockers.map((issue) => issue.label),
      warnings: clearance.warnings.map((issue) => issue.label),
      nextExpiryAt: expiryTimes.length
        ? new Date(Math.min(...expiryTimes)).toISOString()
        : null,
      knowledge: {
        status: knowledgeStatus,
        validUntil: knowledge?.validUntil?.toISOString() ?? null,
        result: knowledge && knowledge.correct != null && knowledge.total != null
          ? `${knowledge.correct} из ${knowledge.total}`
          : null,
      },
      lastInstructionAt: instructionByUser.get(user.id)?.recordedAt.toISOString() ?? null,
    };
  });

  return {
    rows,
    todayByType,
    incidents: { last30: incidentsLast30, previous30: incidentsPrevious30 },
    totals: {
      people: rows.length,
      cleared: rows.filter((row) => row.cleared).length,
      blocked: rows.filter((row) => !row.cleared).length,
      expiring: rows.filter((row) => row.warnings.length > 0).length,
      knowledgeOverdue: rows.filter((row) => row.knowledge.status !== 'valid').length,
    },
    requiredTypesConfigured: requiredTypes.length > 0,
  };
}
