import type {Prisma} from '@/generated/postgres-client/client';
import type {ReadinessTransaction} from '../infrastructure/tenant-transaction';
import {tenantProductionDate} from '../domain/shifts/tenant-production-date';
import {chooseInspectionSource} from '../domain/evaluation/inspection-source';
import {capturedClock, type EvaluationClock} from '../domain/evaluation/clock';
import {evaluateReadiness} from '../domain/evaluation/evaluator';
import {buildEvidence} from '../domain/evaluation/evidence';
import {immutablePublishedRules} from '../domain/evaluation/rules';
import {usesWorkPermits} from '../domain/readiness-rules';

/**
 * Статусы наряда ТО, которые авторитетный расчёт считает «работа не закрыта».
 * Экспортируется, чтобы модуль ТО заказывал пересчёт по тому же списку, а не
 * по своей копии: разъехавшись, они дали бы наряды, меняющие балл молча.
 */
export const OPEN_MAINTENANCE = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

export async function evaluateAuthoritativeReadiness(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  shiftId?: string | null;
  timezone: string;
  clock: EvaluationClock;
}) {
  const now = input.clock.now();
  // Запросы идут последовательно, а не через Promise.all. Транзакция закрепляет
  // за собой одно соединение pg, и параллельная выдача в него — то самое
  // `client.query() when the client is already executing a query`, которое
  // в pg@9 станет ошибкой. Выигрыша от параллельности здесь всё равно не было:
  // драйвер сериализует запросы по тому же соединению.
  const equipment = await input.tx.equipment.findFirst({
    where: {tenantId: input.tenantId, id: input.equipmentId, isActive: true},
    select: {id: true, engineHoursTotal: true, nextMaintenanceAtHours: true, nextMaintenanceDate: true},
  });
  const inspection = await input.tx.inspection.findFirst({
    where: {tenantId: input.tenantId, equipmentId: input.equipmentId, status: 'COMPLETED'},
    orderBy: {inspectionDate: 'desc'},
    select: {id: true, inspectionDate: true, healthScore: true},
  });
  // Предсменный осмотр машиниста — тот же физический обход машины, только
  // записанный рабочим местом оператора, а не журналом ЕО/ТО механика. Пока
  // расчёт смотрел лишь в `Inspection`, машина с полностью пройденным утренним
  // осмотром висела «Осмотр не завершён» и теряла четверть балла готовности:
  // человек сделал работу, а система её не видела.
  //
  // ПРИВЯЗКА К СМЕНЕ. Когда смена известна, осмотр берётся только её —
  // иначе ночная смена получала готовность по утреннему осмотру дневной:
  // обе за одни производственные сутки, и фильтра по суткам мало. Когда
  // смены нет (суточный пересчёт по парку), ограничивать нечем и вопрос
  // стоит иначе: «смотрели ли машину сегодня вообще».
  const operatorInspection = await input.tx.operatorChecklistExecution.findFirst({
    where: {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      status: 'COMPLETED',
      template: {templateKey: 'PRESHIFT_INSPECTION'},
      ...(input.shiftId ? {shiftId: input.shiftId} : {}),
    },
    orderBy: {completedAt: 'desc'},
    select: {id: true, completedAt: true, startedAt: true},
  });
  const openRecords = await input.tx.maintenanceRecord.findMany({
    where: {tenantId: input.tenantId, equipmentId: input.equipmentId, status: {in: [...OPEN_MAINTENANCE]}},
    select: {id: true, type: true, priority: true},
  });
  const permit = await input.tx.workPermit.findFirst({
    where: {
      tenantId: input.tenantId, equipmentId: input.equipmentId, state: {in: ['APPROVED', 'EXPIRED']},
      validFrom: {lte: now},
      OR: input.shiftId ? [{shiftId: null}, {shiftId: input.shiftId}] : [{shiftId: null}],
    },
    orderBy: {validTo: 'desc'}, select: {id: true, state: true, validFrom: true, validTo: true},
  });
  const publishedRow = await input.tx.readinessRuleSet.findFirst({
    where: {tenantId: input.tenantId, status: 'PUBLISHED'}, orderBy: {updatedAt: 'desc'},
  });
  // «Приёмка» — это предсменный допуск диспетчера, а не сдача смены в конце.
  // Раньше признак брался из принятой передачи, но приёмка передачи закрывает
  // смену: десять баллов начислялись уже после того, как работа окончена.
  const startApproval = input.shiftId ? await input.tx.shift.findFirst({
    where: {tenantId: input.tenantId, id: input.shiftId, startedById: {not: null}},
    select: {id: true},
  }) : null;
  // Незакрытый критичный дефект из журнала. Без него запись в журнале
  // ничего не меняла бы в оценке: блокировка держалась только на нарядах
  // ремонта с приоритетом CRITICAL, а дефект — отдельная сущность.
  const blockingDefect = await input.tx.equipmentDefect.findFirst({
    where: {
      tenantId: input.tenantId, equipmentId: input.equipmentId,
      severity: 'CRITICAL', status: {in: ['OPEN', 'IN_WORK']},
    },
    select: {id: true},
  });
  if (!equipment) throw new Error('Authoritative equipment row is unavailable');

  const today = tenantProductionDate(now, input.timezone).getTime();
  const sameDay = (at: Date | null | undefined) => at != null
    && tenantProductionDate(at, input.timezone).getTime() === today;

  const inspectionSameTenantDay = sameDay(inspection?.inspectionDate);
  const operatorAt = operatorInspection?.completedAt ?? operatorInspection?.startedAt ?? null;
  const operatorSameTenantDay = sameDay(operatorAt);
  // Осмотр за сегодня — любой из двух. Наличие вчерашнего даёт половину хода,
  // как и раньше: машину смотрели, но не сегодня.
  const inspectedToday = inspectionSameTenantDay || operatorSameTenantDay;
  const inspectedEver = Boolean(inspection) || Boolean(operatorInspection);

  // Чей осмотр описывает машину на сейчас — правило живёт в домене
  // (`inspection-source.ts`) и покрыто тестами: оно решает, по какому
  // состоянию машине разрешат работу, и на глаз такое не проверяется.
  const inspectionSource = chooseInspectionSource({
    operatorAt,
    operatorSameDay: operatorSameTenantDay,
    mechanicAt: inspection?.inspectionDate ?? null,
  });
  const preferOperatorInspection = inspectionSource === 'OPERATOR_CHECKLIST';

  /**
   * Состояние машины по осмотру машиниста: доля пунктов, отвеченных «норма».
   *
   * У журнала ЕО/ТО есть свой `healthScore`, у чек-листа оператора — нет, а от
   * него зависит число замечаний в формуле готовности. Считаем по ответам:
   * «норма» — единица, «замечание» — половина, «неисправность» — ноль.
   * Замечание не равно отказу, и приравнивать их значило бы штрафовать за
   * честно отмеченную мелочь так же, как за трещину в мачте.
   */
  let operatorHealthScore: number | null = null;
  if (preferOperatorInspection && operatorInspection) {
    const answers = await input.tx.operatorChecklistAnswerRecord.groupBy({
      by: ['result'],
      _count: {_all: true},
      where: {tenantId: input.tenantId, executionId: operatorInspection.id},
    });
    const weight: Record<string, number> = {OK: 1, REMARK: 0.5, FAULT: 0};
    let total = 0;
    let earned = 0;
    for (const row of answers) {
      const count = row._count._all;
      total += count;
      earned += count * (weight[row.result] ?? 0);
    }
    if (total > 0) operatorHealthScore = Math.round((earned / total) * 100);
  }
  const overdueHours = equipment.nextMaintenanceAtHours != null && equipment.engineHoursTotal != null
    ? Math.max(0, equipment.engineHoursTotal - equipment.nextMaintenanceAtHours) : 0;
  const overdueDays = equipment.nextMaintenanceDate && equipment.nextMaintenanceDate < now
    ? Math.ceil((now.getTime() - equipment.nextMaintenanceDate.getTime()) / 86_400_000) : 0;
  // Балл состояния — из того же осмотра, который признан свежим. Смешивать
  // нельзя: балл одного осмотра рядом со ссылкой на другой не проверяется.
  const healthScore = preferOperatorInspection
    ? operatorHealthScore
    : inspection?.healthScore ?? operatorHealthScore ?? null;
  const rules = publishedRow ? immutablePublishedRules({
    version: publishedRow.version,
    status: publishedRow.status,
    criteria: publishedRow.criteria,
    blockers: publishedRow.blockers,
    updatedAt: publishedRow.updatedAt.toISOString(),
    updatedBy: publishedRow.updatedBy ?? undefined,
    publishedAt: publishedRow.publishedAt?.toISOString() ?? null,
  }) : null;
  /*
    «Наряда нет» и «наряд не нужен» — разные ответы, и снимок обязан их
    различать. `null` означает «правила наряд не требуют», и так его читают
    все потребители: балл начисляет полностью, экран пишет «не требуется».

    Пока здесь стоял `Boolean(permit && ...)`, организация без нарядов
    получала `false` — «не подтверждён». Балл от этого не страдал (вес 0), но
    «Центр готовности» показывал шаг «Допуск» невыполненным, а лента
    администратора навсегда застывала на «2 из 3»: ждала документ, который в
    этой организации не выписывают. Расчёт наряд не спрашивал, а интерфейс
    продолжал требовать.

    Без опубликованных правил считаем, что наряды ведут: предполагать
    «не требуется» там, где требования ещё неизвестны, нельзя.
  */
  const permitsInUse = rules ? usesWorkPermits(rules) : true;
  const facts = {
    inspectionCompleted: inspectedToday,
    inspectionProgress: inspectedToday ? 1 : inspectedEver ? 0.5 : 0,
    healthScore,
    meterKnown: equipment.engineHoursTotal != null,
    permitValid: permitsInUse
      ? Boolean(permit && permit.state === 'APPROVED' && permit.validFrom <= now && permit.validTo > now)
      : null,
    permitExpired: permitsInUse
      && Boolean(permit && (permit.state === 'EXPIRED' || permit.validTo <= now)),
    maintenanceConfigured: equipment.nextMaintenanceAtHours != null || equipment.nextMaintenanceDate != null,
    maintenanceOverdueHours: overdueHours,
    maintenanceOverdueDays: overdueDays,
    accepted: Boolean(startApproval),
    criticalDefect: blockingDefect != null || openRecords.some((row) =>
      (row.type === 'FAULT' || row.type === 'REPAIR') && row.priority === 'CRITICAL'),
    findings: healthScore == null ? 0 : Math.max(0, Math.ceil((100 - healthScore) / 10)),
  } as const;
  const evaluation = evaluateReadiness({
    facts, rules,
    evidence: buildEvidence({
      equipmentId: equipment.id,
      // Ссылаемся на тот осмотр, который дал вывод, и говорим, откуда он.
      //
      // ПОЧЕМУ ТИП ОБЯЗАТЕЛЕН. Идентификаторы журнала ЕО и чек-листа
      // машиниста лежат в разных таблицах и внешне неразличимы. Экран вёл
      // «Открыть осмотр» на /inspections/{id} для обоих — и на осмотре
      // машиниста открывалась страница чужой сущности, то есть 404.
      inspectionId: (preferOperatorInspection ? operatorInspection?.id : null)
        ?? inspection?.id ?? null,
      inspectionSource,
      permitId: permit?.id ?? null,
      maintenanceRecordIds: openRecords.map((row) => row.id),
    }),
    clock: capturedClock(now),
  });
  return {
    ...evaluation,
    ruleSetId: publishedRow?.id ?? 'missing-published-readiness-rules',
    serializedBlockers: evaluation.blockers as unknown as Prisma.InputJsonValue,
    serializedWarnings: evaluation.warnings as unknown as Prisma.InputJsonValue,
    serializedEvidence: evaluation.evidence as unknown as Prisma.InputJsonValue,
  };
}
