import type {Prisma} from '@/generated/postgres-client/client';
import {ServiceError} from '@/lib/service-error';
import type {ReportAggregate} from '../../domain';

type ReportState = ReturnType<ReportAggregate['getState']>;

function productionRows(state: ReportState) {
  return [
    state.piles.map((row) => JSON.stringify([row.pileGradeId, row.picketId ?? null, row.count])).sort(),
    state.drillings.map((row) => JSON.stringify([row.typeId, row.picketId ?? null, row.count, row.metersPerUnit, row.meters])).sort(),
  ];
}

export async function requireReportProductionReadiness(
  tx: Prisma.TransactionClient,
  state: ReportState,
  previous: ReportState | undefined,
) {
  if (state.piles.length === 0 && state.drillings.length === 0) return;
  // Повтор с прежней выработкой и изменение простоя не требуют нового допуска.
  // У черновика выработка попадёт в сданный отчёт впервые.
  if (previous?.status === 'submitted'
    && state.equipmentId === previous.equipmentId
    && state.shiftType === previous.shiftType
    && JSON.stringify(productionRows(state)) === JSON.stringify(productionRows(previous))) return;

  const {tenantId, equipmentId, siteId, userId} = state;
  if (!tenantId || !equipmentId) {
    throw new ServiceError('Для записи выработки нужна назначенная установка', 422);
  }
  const crew = await tx.crew.findFirst({
    where: {operatorId: userId, siteId, equipmentId, isActive: true, site: {tenantId}, equipment: {tenantId, isActive: true}},
    select: {id: true},
  });
  if (!crew) throw new ServiceError('Эта установка за вами не закреплена', 422);

  // Идентификатор смены берём из сохранённой связи и сверяем с отчётом.
  // Разрешение диспетчера для другой смены здесь не применяется.
  const shift = state.shiftId ? await tx.shift.findFirst({
    where: {
      id: state.shiftId, tenantId, equipmentId, type: state.shiftType, startedById: userId,
      productionDate: new Date(state.date + 'T00:00:00.000Z'),
    },
    select: {id: true, timezone: true},
  }) : null;
  const timezone = shift?.timezone ?? (await tx.tenantSettings.findUnique({
    where: {tenantId}, select: {timezone: true},
  }))?.timezone ?? 'Europe/Moscow';
  const {previewAuthoritativeShiftStart} = await import('@/modules/readiness/server');
  const decision = await previewAuthoritativeShiftStart({tx, tenantId, equipmentId, shiftId: shift?.id, timezone, now: new Date()});
  if (!decision.allowed) {
    throw new ServiceError(decision.evaluation.blockers.map((blocker) => blocker.label).join('; '), 422);
  }
}
