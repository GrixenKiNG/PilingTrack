import type { NextRequest } from 'next/server';
import { ReadinessCommandError } from '@/modules/readiness/application/command-pipeline/errors';
import { withReadinessRequestTransaction } from '@/modules/readiness/infrastructure/tenant-transaction';
import { resolveReadinessRequestContext } from '../_shared/request-context';
import { readinessErrorResponse, readinessResponse } from '../_shared/response';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;

  try {
    if (!context.capabilities.has('readiness.read')) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет доступа к контуру технической готовности');
    }
    const equipmentId = request.nextUrl.searchParams.get('equipmentId');
    const rows = await withReadinessRequestTransaction(context.tenantId, async (tx) => {
      const current = await tx.currentReadiness.findMany({
        where: { tenantId: context.tenantId, ...(equipmentId ? { equipmentId } : {}) },
        orderBy: [{ calculatedAt: 'desc' }, { equipmentId: 'asc' }],
      });
      const snapshots = await tx.readinessScoreSnapshot.findMany({
        where: { tenantId: context.tenantId, id: { in: current.map((item) => item.snapshotId) } },
      });
      const byId = new Map(snapshots.map((item) => [item.id, item]));
      return current.map((item) => {
        const snapshot = byId.get(item.snapshotId);
        return {
          equipmentId: item.equipmentId,
          snapshotId: item.snapshotId,
          status: item.status,
          // Снимки до 2026-08-13 вердикта не содержат — отдаём null, экран
          // в этом случае откатывается на двоичный статус.
          verdict: item.verdict ?? snapshot?.verdict ?? null,
          score: item.score,
          calculatedAt: item.calculatedAt.toISOString(),
          blockers: snapshot?.blockers ?? [],
          warnings: snapshot?.warnings ?? [],
          evidence: snapshot?.evidence ?? [],
          facts: snapshot?.facts ?? null,
          triggerType: snapshot?.triggerType ?? null,
          ruleSetVersion: snapshot?.ruleSetVersion ?? null,
        };
      });
    });
    return readinessResponse({ body: { data: rows }, status: 200, correlationId: context.correlationId, requestId: context.requestId });
  } catch (error) {
    if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId);
    throw error;
  }
}
