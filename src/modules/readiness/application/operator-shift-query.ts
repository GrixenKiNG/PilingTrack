import { db } from '@/lib/db';

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
  equipment: { id: string; name: string; model: string } | null;
  shift: {
    id: string;
    state: string;
    version: number;
    type: string;
    productionDate: string;
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
  /** Передача от предыдущей смены, ожидающая приёмки. */
  incomingHandover: { id: string; shiftId: string; summary: string; submittedById: string } | null;
  /** Разрешение диспетчера на пуск, выданное этой смене. */
  startWaiver: { id: string; reason: string } | null;
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

  const empty: OperatorShiftFacts = {
    equipment: null, shift: null, readiness: null,
    inspection: { preShift: null, postShift: null },
    report: null, meterKnownToday: false, incomingHandover: null, startWaiver: null,
  };

  const crew = await db.crew.findUnique({
    where: { operatorId },
    select: {
      isActive: true,
      equipment: { select: { id: true, name: true, model: true, tenantId: true } },
    },
  });
  // Машина чужой организации к этому оператору отношения не имеет. Сравнение
  // строгое: тенант обязателен, «или NULL» здесь недопустимо.
  if (!crew?.isActive || !crew.equipment || crew.equipment.tenantId !== tenantId) return empty;
  const equipment = crew.equipment;

  const shift = await db.shift.findFirst({
    where: {
      tenantId,
      equipmentId: equipment.id,
      state: { in: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED', 'HANDOVER_PENDING'] },
    },
    orderBy: { productionDate: 'desc' },
    select: { id: true, state: true, version: true, type: true, productionDate: true },
  });

  const [current, meterToday, incoming] = await Promise.all([
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
      where: { tenantId, state: 'SUBMITTED', shift: { equipmentId: equipment.id } },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, shiftId: true, summary: true, submittedById: true },
    }),
  ]);

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
      equipment: { id: equipment.id, name: equipment.name, model: equipment.model },
      readiness: current
        ? { verdict: current.verdict, status: current.status, score: current.score, blockers }
        : null,
      meterKnownToday: meterToday > 0,
      incomingHandover: incoming,
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
      select: { id: true, status: true },
    }),
    db.shiftStartWaiver.findFirst({
      where: { tenantId, shiftId: shift.id },
      select: { id: true, reason: true },
    }),
  ]);

  const byPhase = (phase: 'PRE_SHIFT' | 'POST_SHIFT') => {
    const found = inspections.find((item) => item.phase === phase);
    if (!found) return null;
    const total = Array.isArray(found.templateSnapshot) ? found.templateSnapshot.length : 0;
    return { id: found.id, status: found.status, answered: found._count.answers, total };
  };

  return {
    equipment: { id: equipment.id, name: equipment.name, model: equipment.model },
    shift: {
      id: shift.id, state: shift.state, version: shift.version, type: shift.type,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
    },
    readiness: current
      ? { verdict: current.verdict, status: current.status, score: current.score, blockers }
      : null,
    inspection: { preShift: byPhase('PRE_SHIFT'), postShift: byPhase('POST_SHIFT') },
    report,
    meterKnownToday: meterToday > 0,
    incomingHandover: incoming,
    startWaiver: waiver,
  };
}
