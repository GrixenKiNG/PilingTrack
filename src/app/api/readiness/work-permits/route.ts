import type {NextRequest} from 'next/server';
import {resolveReadinessCapabilities} from '@/modules/readiness/application/capabilities';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {createWorkPermitCommand} from '@/modules/readiness/application/permits/commands';
import {queryWorkPermits, type PermitListFilters} from '@/modules/readiness/application/permits/queries';
import {createWorkPermitSchema} from '@/modules/readiness/application/permits/schemas';
import {parseReadinessReadFilters} from '@/modules/readiness/application/read-filters';
import {withReadinessRequestTransaction, withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../_shared/response';
import {withReadinessCommand} from '../_shared/route-adapter';

export const runtime = 'nodejs';

const readJson = async (request: NextRequest) => {
  try { return await request.json(); }
  catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Тело запроса должно быть в формате JSON'); }
};

export async function GET(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context!;
  try {
    if (!resolveReadinessCapabilities(context.actorRole).has('readiness.read')) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет доступа к контуру технической готовности');
    }
    const params = request.nextUrl.searchParams;
    const allowed = new Set(['equipmentId', 'state', 'risk', 'limit', 'cursor', 'status', 'from', 'to']);
    if ([...params.keys()].some((key) => !allowed.has(key))) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестный фильтр нарядов');
    }
    const limit = params.has('limit') ? Number(params.get('limit')) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'limit must be between 1 and 200');
    }
    const result = await withReadinessRequestTransaction(context.tenantId, async (tx) => {
      const timezone = (await tx.tenantSettings.findUnique({where: {tenantId: context.tenantId}, select: {timezone: true}}))?.timezone;
      const common = parseReadinessReadFilters(params, timezone ?? undefined);
      const state = params.get('state') ?? common.status;
      const risk = params.get('risk') ?? common.risk;
      if (state && !['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXPIRED', 'REVOKED'].includes(state)) {
        throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестное состояние наряда');
      }
      if (risk && !['NORMAL', 'ELEVATED'].includes(risk)) {
        throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестный уровень риска наряда');
      }
      const filters: PermitListFilters = {
        equipmentId: params.get('equipmentId') ?? undefined,
        state: state as PermitListFilters['state'], risk: risk as PermitListFilters['risk'],
        from: common.from, to: common.to, limit, cursor: params.get('cursor') ?? undefined,
      };
      return queryWorkPermits(tx, context.tenantId, filters);
    });
    return readinessResponse({body: {...result, meta: {correlationId: context.correlationId,
      filters: Object.fromEntries(params.entries())}},
      status: 200, correlationId: context.correlationId, requestId: context.requestId});
  } catch (error) {
    if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId);
    throw error;
  }
}

export const POST = withReadinessCommand(async (request, context) => {
  const parsed = createWorkPermitSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные данные наряда', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => createWorkPermitCommand({tx, context, key: request.headers.get('idempotency-key'), payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status,
    headers: result.headers, correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-permits'});
