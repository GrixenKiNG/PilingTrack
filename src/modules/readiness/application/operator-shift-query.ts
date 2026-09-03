import { db } from '@/lib/db';
import { getOperatorClearance, type ClearanceDocument } from '@/modules/users';
import { hasPostShiftSection } from '@/modules/inspections';

/**
 * Состояние смены глазами оператора — всё, что нужно его экрану, одним запросом.
 *
 * Почему отдельный запрос, а не `bootstrap`. Тот отдаёт справочники, счётчики и
 * матрицу экранов администраторского модуля — килобайты, которых на телефоне в
 * поле не нужно. Здесь ровно факты одной машины и одной смены.
 *
 * Фазу здесь НЕ считаем: это правило показа, оно живёт на экране
 * (`components/piling/operator/shift-phase.ts`) и покрыто тестами как чистая
 * функция. Сервер отдаёт факты, экран решает, что предложить нажать.
 */
export interface OperatorShiftFacts {
  /**
   * Установки, закреплённые за оператором администратором. Из этого списка он
   * выбирает машину, открывая смену. Пусто — администратор ещё не закрепил.
   */
  assignments: Array<{ equipmentId: string; equipmentName: string; model: string; siteId: string; siteName: string }>;
  /**
   * Машина сегодняшней смены. Пока смены нет и закреплённых машин несколько —
   * `null`: выбирать за человека нельзя, он выбирает сам.
   *
   * Наработка и порог следующего ТО — для карточки приёмки: оператор принимает
   * машину, а не строку в списке, и «сколько осталось до ТО» он должен видеть
   * до того, как распишется за неё.
   */
  equipment: {
    id: string; name: string; model: string;
    engineHoursTotal: number | null;
    nextMaintenanceAtHours: number | null;
  } | null;
  shift: {
    id: string;
    state: string;
    version: number;
    type: string;
    productionDate: string;
    /** Когда смена фактически пущена — от него считается время в работе. */
    startedAt: string | null;
  } | null;
  readiness: {
    verdict: string | null;
    status: string;
    score: number;
    blockers: Array<{ label: string; actionLabel: string }>;
  } | null;
  /** Осмотр текущей смены по фазам: до работ и после. */
  inspection: {
    preShift: { id: string; status: string; answered: number; total: number } | null;
    postShift: { id: string; status: string; answered: number; total: number } | null;
  };
  /** Сменный отчёт этой смены. */
  report: { id: string; status: string } | null;
  /** Показание счётчика за сегодня снято. */
  meterKnownToday: boolean;
  /**
   * Последнее показание счётчика моточасов. Экран показывает его на пуске
   * («на старт») и в работе — из него же видно наработку за смену.
   */
  meterCurrent: number | null;
  /**
   * Откуда взята цифра моточасов и когда.
   *
   * Без этого экран показывал голое число, и первый же вопрос был «а это
   * откуда?». `reading` — снятое кем-то показание счётчика (есть дата),
   * `equipment` — наработка из карточки установки, то есть цифра, которую
   * последним правил администратор, а не то, что сейчас на приборе.
   */
  meterSource: 'reading' | 'equipment' | null;
  /** Когда снято показание. Только для `meterSource: 'reading'`. */
  meterRecordedAt: string | null;
  /** Свай зачтено в сегодняшнем отчёте — счётчик на экране работы. */
  pilesToday: number;
  /**
   * Передача от предыдущей смены, ожидающая приёмки.
   *
   * Имя сдающего, а не только его идентификатор: «Принять машину у Петрова
   * П.П.» — это разговор двух людей, и второго надо назвать.
   */
  incomingHandover: {
    id: string; shiftId: string; summary: string;
    submittedById: string; submittedByName: string | null;
    /**
     * Версия записи. Обязательна: приёмка — команда контура, и без
     * `expectedVersion`/`if-match` сервер отвечает 428. Экран оператора её не
     * получал и отправлял пустое тело — принять передачу было нельзя вовсе.
     */
    version: number;
  } | null;
  /** Разрешение диспетчера на пуск, выданное этой смене. */
  startWaiver: { id: string; reason: string } | null;
  /**
   * Допуск работника по документам. Препятствия останавливают пуск смены,
   * предупреждения только показываются: истекающее удостоверение — повод
   * заняться продлением, а не повод не выйти на работу.
   */
  clearance: {
    blockers: string[];
    warnings: string[];
    /**
     * Обязательные виды документов с их состоянием — включая благополучное.
     *
     * Экран допуска показывает карточку «✓ удостоверение действительно,
     * ✓ медсправка действительна» одним взглядом. Из одних препятствий такую
     * карточку не собрать: у допущенного оператора список пуст, и экран не мог
     * сказать ему ничего, кроме молчания.
     */
    documents: ClearanceDocument[];
  };
  /**
   * У чек-листа этой машины есть раздел на конец смены.
   *
   * `false` — осмотра после работ для неё не существует, и требовать его перед
   * сдачей нельзя: смена застряла бы навсегда. Настройку правит механик, а
   * человек у машины ждать этого не должен.
   */
  postShiftAvailable: boolean;
}

const startOfLocalDay = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * Собирает факты по бригаде оператора.
 *
 * Возвращает `equipment: null`, если оператор не назначен на активную бригаду —
 * это не ошибка, а нормальное состояние человека, которому ещё не выдали
 * машину. Экран покажет, что делать дальше.
 */
export async function getOperatorShiftFacts(
  tenantId: string,
  operatorId: string,
  now: Date = new Date(),
): Promise<OperatorShiftFacts> {
  if (!tenantId) throw new Error('tenantId is required');

  // Допуск по документам считаем до всего остального: он не зависит ни от
  // машины, ни от смены, и нужен даже тогда, когда ни того ни другого нет —
  // человек должен узнать о просроченном удостоверении заранее, а не в момент
  // нажатия «начать смену».
  const clearanceResult = await getOperatorClearance(tenantId, operatorId, now);
  const clearance = {
    blockers: clearanceResult.blockers.map((issue) => issue.label),
    warnings: clearanceResult.warnings.map((issue) => issue.label),
    documents: clearanceResult.documents,
  };

  const empty: OperatorShiftFacts = {
    assignments: [], equipment: null, shift: null, readiness: null,
    inspection: { preShift: null, postShift: null },
    report: null, meterKnownToday: false, meterCurrent: null,
    meterSource: null, meterRecordedAt: null, pilesToday: 0,
    incomingHandover: null, startWaiver: null,
    clearance, postShiftAvailable: false,
  };

  // Машина чужой организации к этому оператору отношения не имеет. Сравнение
  // строгое по обеим связям: тенант обязателен, «или NULL» здесь недопустимо.
  // isActive у самой установки — не придирка: смену на списанной машине
  // команда всё равно не откроет («Запись не найдена»), и предлагать её в
  // списке значит вести человека в тупик.
  const crews = await db.crew.findMany({
    where: { operatorId, isActive: true, equipment: { tenantId, isActive: true }, site: { tenantId } },
    select: {
      equipment: {
        select: {
          id: true, name: true, model: true,
          engineHoursTotal: true, nextMaintenanceAtHours: true,
        },
      },
      site: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (crews.length === 0) return empty;

  const assignments = crews.map((crew) => ({
    equipmentId: crew.equipment.id,
    equipmentName: crew.equipment.name,
    model: crew.equipment.model,
    siteId: crew.site.id,
    siteName: crew.site.name,
  }));

  // Смена ищется по всем закреплённым машинам сразу: какая открыта — на той
  // человек сегодня и работает.
  const shift = await db.shift.findFirst({
    where: {
      tenantId,
      equipmentId: { in: crews.map((crew) => crew.equipment.id) },
      state: { in: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED', 'HANDOVER_PENDING'] },
    },
    orderBy: { productionDate: 'desc' },
    select: {
      id: true, state: true, version: true, type: true, productionDate: true,
      equipmentId: true, startedAt: true,
    },
  });

  // Машина смены; без смены — единственная закреплённая, иначе выбор за
  // человеком и подставлять произвольную нельзя.
  const equipment = shift
    ? crews.find((crew) => crew.equipment.id === shift.equipmentId)?.equipment ?? null
    : crews.length === 1 ? crews[0].equipment : null;
  if (!equipment) return { ...empty, assignments };

  const [current, meterToday, incoming, lastMeter] = await Promise.all([
    db.currentReadiness.findFirst({
      where: { tenantId, equipmentId: equipment.id },
      select: { verdict: true, status: true, score: true, snapshotId: true },
    }),
    db.meterReading.count({
      where: { tenantId, equipmentId: equipment.id, recordedAt: { gte: startOfLocalDay(now) } },
    }),
    // Передача предыдущей смены, ожидающая решения. Свою собственную оператор
    // принять не сможет — это проверит команда, — но видеть её он должен.
    db.shiftHandover.findFirst({
      // Состояние смены в условии обязательно, а не для красоты: приёмка
      // передачи закрывает смену и требует от неё HANDOVER_PENDING. Передача
      // на уже закрытой смене принята быть не может — предлагать её экрану
      // значит запереть оператора на первом шаге с ответом 409.
      where: {
        tenantId,
        state: 'SUBMITTED',
        shift: { equipmentId: equipment.id, state: 'HANDOVER_PENDING' },
      },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, shiftId: true, summary: true, submittedById: true, version: true },
    }),
    // Последнее показание счётчика — не только за сегодня: на карточке приёмки
    // машины показание вчерашней смены честнее прочерка.
    db.meterReading.findFirst({
      where: { tenantId, equipmentId: equipment.id },
      orderBy: { recordedAt: 'desc' },
      select: { engineHours: true, recordedAt: true },
    }),
  ]);

  // Имя сдающего — отдельным запросом: у `ShiftHandover` нет связи с `User`,
  // там только идентификатор. Спрашиваем, лишь когда есть кого называть.
  const submitter = incoming
    ? await db.user.findFirst({
        where: { id: incoming.submittedById, tenantId },
        select: { name: true },
      })
    : null;
  const handover = incoming
    ? {
        id: incoming.id, shiftId: incoming.shiftId, summary: incoming.summary,
        submittedById: incoming.submittedById,
        submittedByName: submitter?.name ?? null,
        version: incoming.version,
      }
    : null;
  const meterCurrent = lastMeter?.engineHours ?? equipment.engineHoursTotal ?? null;
  const meterSource: 'reading' | 'equipment' | null = lastMeter
    ? 'reading'
    : equipment.engineHoursTotal != null ? 'equipment' : null;
  const meterRecordedAt = lastMeter?.recordedAt?.toISOString() ?? null;
  const equipmentDto = {
    id: equipment.id, name: equipment.name, model: equipment.model,
    engineHoursTotal: equipment.engineHoursTotal,
    nextMaintenanceAtHours: equipment.nextMaintenanceAtHours,
  };

  const snapshot = current
    ? await db.readinessScoreSnapshot.findFirst({
        where: { tenantId, id: current.snapshotId },
        select: { blockers: true },
      })
    : null;
  const blockers = Array.isArray(snapshot?.blockers)
    ? (snapshot.blockers as Array<{ label?: string; actionLabel?: string }>)
        .map((item) => ({ label: item.label ?? 'Препятствие', actionLabel: item.actionLabel ?? '' }))
    : [];

  if (!shift) {
    return {
      ...empty,
      assignments,
      equipment: equipmentDto,
      readiness: current
        ? { verdict: current.verdict, status: current.status, score: current.score, blockers }
        : null,
      meterKnownToday: meterToday > 0,
      meterCurrent,
      meterSource,
      meterRecordedAt,
      incomingHandover: handover,
    };
  }

  const [inspections, report, waiver] = await Promise.all([
    db.inspection.findMany({
      where: { tenantId, shiftId: shift.id },
      select: { id: true, status: true, phase: true, templateSnapshot: true, _count: { select: { answers: true } } },
    }),
    db.report.findFirst({
      where: { tenantId, shiftId: shift.id },
      orderBy: { updatedAt: 'desc' },
      // Сваи считаем суммой по строкам работ отчёта, а не числом строк: в одной
      // строке может стоять «пикет 12, свай 4», и подсчёт строк дал бы 1.
      select: { id: true, status: true, piles: { select: { count: true } } },
    }),
    db.shiftStartWaiver.findFirst({
      where: { tenantId, shiftId: shift.id },
      select: { id: true, reason: true },
    }),
  ]);

  // Признак читаем один раз на сборку фактов: он зависит от шаблонов, а не от
  // хода смены, и на каждом шаге не меняется.
  const postShiftAvailable = await hasPostShiftSection(tenantId, equipment.id);

  const byPhase = (phase: 'PRE_SHIFT' | 'POST_SHIFT') => {
    const found = inspections.find((item) => item.phase === phase);
    if (!found) return null;
    const total = Array.isArray(found.templateSnapshot) ? found.templateSnapshot.length : 0;
    return { id: found.id, status: found.status, answered: found._count.answers, total };
  };

  return {
    assignments,
    equipment: equipmentDto,
    shift: {
      id: shift.id, state: shift.state, version: shift.version, type: shift.type,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
      startedAt: shift.startedAt?.toISOString() ?? null,
    },
    readiness: current
      ? { verdict: current.verdict, status: current.status, score: current.score, blockers }
      : null,
    inspection: { preShift: byPhase('PRE_SHIFT'), postShift: byPhase('POST_SHIFT') },
    report: report ? { id: report.id, status: report.status } : null,
    meterKnownToday: meterToday > 0,
    meterCurrent,
    meterSource,
    meterRecordedAt,
    pilesToday: report?.piles.reduce((sum, row) => sum + row.count, 0) ?? 0,
    incomingHandover: handover,
    startWaiver: waiver,
    clearance,
    postShiftAvailable,
  };
}
