import type { NextRequest } from 'next/server';
import { ReadinessCommandError } from '@/modules/readiness/application/command-pipeline/errors';
import { parseReadinessReadFilters, serializeReadinessFilters } from '@/modules/readiness/application/read-filters';
import { PrismaAuditRepository } from '@/modules/readiness/infrastructure/audit/audit-repository';
import { verifyTenantAuditChain } from '@/modules/readiness/infrastructure/audit/verify-chain';
import { withReadinessRequestTransaction } from '@/modules/readiness/infrastructure/tenant-transaction';
import { resolveReadinessRequestContext } from '../_shared/request-context';
import { readinessErrorResponse, readinessResponse } from '../_shared/response';
import {withApi} from '@/core/api-wrapper';

export const runtime = 'nodejs';

async function handleGet(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  try {
    if (!context.capabilities.has('readiness.audit.read')) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет доступа к журналу аудита');
    }
    const params = request.nextUrl.searchParams;
    const allowed = new Set(['eventType', 'actor', 'from', 'to', 'limit']);
    if ([...params.keys()].some((key) => !allowed.has(key))) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестный фильтр аудита');
    }
    const limit = Math.min(500, Math.max(1, Number(params.get('limit') ?? 200)));
    if (!Number.isInteger(limit)) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Некорректный размер страницы');
    const result = await withReadinessRequestTransaction(context.tenantId, async (tx) => {
      const repository = new PrismaAuditRepository(tx);
      const timezone = (await tx.tenantSettings.findUnique({where: {tenantId: context.tenantId}, select: {timezone: true}}))?.timezone;
      const filters = parseReadinessReadFilters(params, timezone ?? undefined);
      const [{ events }, verification] = await Promise.all([
        repository.readChain(context.tenantId),
        verifyTenantAuditChain(repository, context.tenantId),
      ]);
      const actor = filters.actor?.toLocaleLowerCase('ru-RU');
      const filtered = events.filter((event) => {
        const occurredAt = new Date(event.occurredAt);
        if (filters.from && occurredAt < filters.from) return false;
        if (filters.to && occurredAt > filters.to) return false;
        if (filters.eventType && event.action !== filters.eventType && event.entity.type !== filters.eventType) return false;
        if (actor && ![event.actor.id, event.actor.name, event.actor.role, event.actor.actingAs]
          .some((value) => value?.toLocaleLowerCase('ru-RU').includes(actor))) return false;
        return true;
      });
      return { data: filtered.slice(-limit).reverse(), verification,
        page: {limit, total: filtered.length}, filters: serializeReadinessFilters(filters) };
    });
    return readinessResponse({ body: result, status: 200, correlationId: context.correlationId, requestId: context.requestId });
  } catch (error) {
    if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId);
    throw error;
  }
}

export const GET = withApi(handleGet, {domain: 'readiness-audit'});
