import {capturedClock} from '../../domain/evaluation/clock';
import {createDeduplicatedSnapshot} from '../../infrastructure/snapshots/snapshot-repository';
import {withReadinessWorkerTransaction} from '../../infrastructure/tenant-transaction';
import {evaluateAuthoritativeReadiness} from '../readiness-score';
import {advanceCurrentReadiness} from '../projection/current-read-model';
import {ReadinessBackfillProgressRepository} from './progress-repository';

export const READINESS_BACKFILL_BATCH_SIZE = 200;

export async function backfillTenantReadiness(input: {
  tenantId: string;
  clock?: Date;
  batchSize?: number;
}) {
  const clock = new Date((input.clock ?? new Date()).getTime());
  const batchSize = input.batchSize ?? READINESS_BACKFILL_BATCH_SIZE;
  await withReadinessWorkerTransaction(input.tenantId, (tx) =>
    new ReadinessBackfillProgressRepository(tx).start(input.tenantId));

  try {
    while (true) {
      const processed = await withReadinessWorkerTransaction(input.tenantId, async (tx) => {
        const progressRepo = new ReadinessBackfillProgressRepository(tx);
        const progress = await progressRepo.get(input.tenantId);
        const equipment = await tx.equipment.findMany({
          where: {tenantId: input.tenantId, isActive: true,
            ...(progress?.lastEquipmentId ? {id: {gt: progress.lastEquipmentId}} : {})},
          orderBy: {id: 'asc'}, take: batchSize, select: {id: true},
        });
        if (!equipment.length) return 0;
        const settings = await tx.tenantSettings.findUnique({
          where: {tenantId: input.tenantId}, select: {timezone: true},
        });
        for (const row of equipment) {
          const evaluation = await evaluateAuthoritativeReadiness({
            tx, tenantId: input.tenantId, equipmentId: row.id, shiftId: null,
            timezone: settings?.timezone ?? 'Europe/Moscow', clock: capturedClock(clock),
          });
          const snapshot = await createDeduplicatedSnapshot(tx, {
            tenantId: input.tenantId, equipmentId: row.id, ruleSetId: evaluation.ruleSetId,
            // Ключ дедупликации включает набор правил: повторный прогон по тем
            // же правилам ничего не задваивает, а после публикации новой
            // редакции даёт свежий снимок вместо тихого возврата старого.
            triggerType: 'MIGRATION',
            triggerId: `tech-readiness-v1:${evaluation.ruleSetId}:${row.id}`,
          }, evaluation);
          await advanceCurrentReadiness({
            tx, tenantId: input.tenantId, equipmentId: row.id, snapshotId: snapshot.id,
            status: snapshot.status, verdict: snapshot.verdict, score: snapshot.score,
            calculatedAt: snapshot.calculatedAt,
          });
        }
        await progressRepo.checkpoint({
          tenantId: input.tenantId, lastEquipmentId: equipment[equipment.length - 1].id,
          processed: equipment.length,
        });
        return equipment.length;
      });
      if (processed === 0) break;
    }
    await withReadinessWorkerTransaction(input.tenantId, (tx) =>
      new ReadinessBackfillProgressRepository(tx).complete(input.tenantId, clock));
  } catch (error) {
    await withReadinessWorkerTransaction(input.tenantId, (tx) =>
      new ReadinessBackfillProgressRepository(tx).fail(input.tenantId, error));
    throw error;
  }

  const {activeEquipment, migrationSnapshots, currentRows} = await withReadinessWorkerTransaction(
    input.tenantId,
    async (tx) => {
      const activeIds = (await tx.equipment.findMany({
        where: {tenantId: input.tenantId, isActive: true},
        orderBy: {id: 'asc'},
        select: {id: true},
      })).map((row) => row.id);
      if (activeIds.length === 0) {
        return {activeEquipment: 0, migrationSnapshots: 0, currentRows: 0};
      }
      const [migrationSnapshots, currentRows] = await Promise.all([
        // Считаем технику, а не снимки: после второго прогона по новым правилам
        // снимков больше, чем установок, и сверка по их числу давала бы ложную
        // ошибку.
        tx.readinessScoreSnapshot.groupBy({
          by: ['equipmentId'],
          where: {tenantId: input.tenantId, equipmentId: {in: activeIds}, triggerType: 'MIGRATION'},
        }).then((rows) => rows.length),
        tx.currentReadiness.count({where: {tenantId: input.tenantId, equipmentId: {in: activeIds}}}),
      ]);
      return {activeEquipment: activeIds.length, migrationSnapshots, currentRows};
    },
  );
  return {tenantId: input.tenantId, activeEquipment, migrationSnapshots, currentRows,
    reconciled: activeEquipment === migrationSnapshots && activeEquipment === currentRows};
}
