import type { NextRequest } from 'next/server';
import { ReadinessCommandError } from '@/modules/readiness/application/command-pipeline/errors';
import { parseReadinessReadFilters, serializeReadinessFilters } from '@/modules/readiness/application/read-filters';
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
    const params = request.nextUrl.searchParams;
    const allowed = new Set(['equipmentId', 'status', 'from', 'to', 'limit']);
    if ([...params.keys()].some((key) => !allowed.has(key))) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестный фильтр истории');
    }
    const limit = Math.min(500, Math.max(1, Number(params.get('limit') ?? 200)));
    if (!Number.isInteger(limit)) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Некорректный размер страницы');
    const result = await withReadinessRequestTransaction(context.tenantId, async (tx) => {
      const timezone = (await tx.tenantSettings.findUnique({where: {tenantId: context.tenantId}, select: {timezone: true}}))?.timezone;
      const filters = parseReadinessReadFilters(params, timezone ?? undefined);
      const data = await tx.readinessScoreSnapshot.findMany({
        where: { tenantId: context.tenantId,
          ...(filters.equipmentId ? { equipmentId: filters.equipmentId } : {}),
          ...(filters.status ? {status: filters.status} : {}),
          ...(filters.from || filters.to ? {calculatedAt: {
            ...(filters.from ? {gte: filters.from} : {}),
            ...(filters.to ? {lte: filters.to} : {}),
          }} : {}),
        },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      return {data, filters: serializeReadinessFilters(filters)};
    });
    return readinessResponse({
      body: {
        data: result.data.map((item) => ({
          id: item.id,
          equipmentId: item.equipmentId,
          shiftId: item.shiftId,
          triggerId: item.triggerId,
          status: item.status,
          score: item.score,
          blockers: item.blockers,
          warnings: item.warnings,
          evidence: item.evidence,
          facts: item.facts ?? null,
          triggerType: item.triggerType,
          ruleSetVersion: item.ruleSetVersion,
          calculatedAt: item.calculatedAt.toISOString(),
          factsHash: Buffer.from(item.factsHash).toString('hex'),
        })),
        page: { limit, total: result.data.length },
        filters: result.filters,
      },
      status: 200,
      correlationId: context.correlationId,
      requestId: context.requestId,
    });
  } catch (error) {
    if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId);
    throw error;
  }
}
