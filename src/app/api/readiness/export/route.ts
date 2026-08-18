import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {recordChainedReadinessAudit} from '@/modules/readiness/infrastructure/audit/record-audit';
import {buildReadinessCsv} from '@/modules/readiness/application/csv-export';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {parseReadinessReadFilters, serializeReadinessFilters} from '@/modules/readiness/application/read-filters';
import {normalizeTenantTimezone} from '@/modules/readiness/domain/shifts/tenant-production-date';
import {PrismaAuditRepository} from '@/modules/readiness/infrastructure/audit/audit-repository';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse} from '../_shared/response';
import {withApi} from '@/core/api-wrapper';

export const runtime = 'nodejs';

const DATASETS = new Set(['fleet', 'permits', 'reports', 'dictionary', 'audit']);

async function handleGet(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  try {
    const dataset = request.nextUrl.searchParams.get('dataset') ?? '';
    if (!DATASETS.has(dataset)) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Неизвестный набор данных для выгрузки');
    }
    const capabilities = context.capabilities;
    const requiredAbility = dataset === 'audit' ? 'readiness.audit.export' : 'readiness.read';
    if (!capabilities.has(requiredAbility)) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет прав на выгрузку');
    }
    const generatedAt = new Date();
    const result = await withReadinessSerializableTransaction(context.tenantId, async (tx) => {
      const settings = await tx.tenantSettings.findUnique({
        where: {tenantId: context.tenantId},
        select: {timezone: true},
      });
      const timezone = normalizeTenantTimezone(settings?.timezone);
      const filters = parseReadinessReadFilters(request.nextUrl.searchParams, timezone);
      let rows: unknown[][];

      if (dataset === 'fleet' || dataset === 'dictionary') {
        const equipment = await tx.equipment.findMany({
          where: {
            tenantId: context.tenantId,
            ...(filters.equipmentId ? {id: filters.equipmentId} : {}),
            ...(filters.status === 'ACTIVE' ? {isActive: true} : filters.status === 'ARCHIVED' ? {isActive: false} : {}),
          },
          orderBy: [{name: 'asc'}, {id: 'asc'}],
        });
        rows = [
          ['ID', 'Наименование', 'Модель', 'Статус', 'Заводской №', 'Инвентарный №', 'Моточасы', 'Следующее ТО, м/ч'],
          ...equipment.map((item) => [
            item.id, item.name, item.model, item.isActive ? 'ACTIVE' : 'ARCHIVED',
            item.serialNumber, item.inventoryNumber, item.engineHoursTotal, item.nextMaintenanceAtHours,
          ]),
        ];
      } else if (dataset === 'permits') {
        const permits = await tx.workPermit.findMany({
          where: {
            tenantId: context.tenantId,
            ...(filters.equipmentId ? {equipmentId: filters.equipmentId} : {}),
            ...(filters.status ? {state: filters.status as never} : {}),
            ...(filters.risk ? {risk: filters.risk} : {}),
            ...(filters.from || filters.to ? {
              validFrom: {...(filters.to ? {lte: filters.to} : {})},
              validTo: {...(filters.from ? {gte: filters.from} : {})},
            } : {}),
          },
          include: {approvals: {where: {valid: true}, orderBy: {approvedAt: 'asc'}}},
          orderBy: [{updatedAt: 'desc'}, {id: 'desc'}],
        });
        rows = [
          ['ID', 'Установка', 'Смена', 'Риск', 'Статус', 'Объём работ', 'Действует с', 'Действует до', 'Согласования'],
          ...permits.map((item) => [
            item.id, item.equipmentId, item.shiftId, item.risk, item.state, item.scope,
            item.validFrom, item.validTo, item.approvals.map((approval) => approval.role).join(', '),
          ]),
        ];
      } else if (dataset === 'audit') {
        const {events} = await new PrismaAuditRepository(tx).readChain(context.tenantId);
        const actorNeedle = filters.actor?.toLocaleLowerCase('ru-RU');
        const filtered = events.filter((event) => {
          const occurredAt = new Date(event.occurredAt);
          if (filters.from && occurredAt < filters.from) return false;
          if (filters.to && occurredAt > filters.to) return false;
          if (filters.eventType && event.action !== filters.eventType && event.entity.type !== filters.eventType) return false;
          if (actorNeedle && ![event.actor.id, event.actor.name, event.actor.role, event.actor.actingAs]
            .some((value) => value?.toLocaleLowerCase('ru-RU').includes(actorNeedle))) return false;
          return true;
        });
        rows = [
          ['Sequence', 'Дата', 'Актор', 'Роль', 'Действие', 'Сущность', 'ID сущности', 'Версия', 'Prev hash', 'Hash'],
          ...filtered.map((event) => [
            event.sequence, event.occurredAt, event.actor.name, event.actor.actingAs || event.actor.role,
            event.action, event.entity.type, event.entity.id, event.entity.version, event.prevHash, event.hash,
          ]),
        ];
      } else {
        const [snapshots, audit] = await Promise.all([
          tx.readinessScoreSnapshot.findMany({
            where: {
              tenantId: context.tenantId,
              ...(filters.equipmentId ? {equipmentId: filters.equipmentId} : {}),
              ...(filters.status ? {status: filters.status} : {}),
              ...(filters.from || filters.to ? {calculatedAt: {
                ...(filters.from ? {gte: filters.from} : {}),
                ...(filters.to ? {lte: filters.to} : {}),
              }} : {}),
            },
            orderBy: [{calculatedAt: 'desc'}, {id: 'desc'}],
          }),
          new PrismaAuditRepository(tx).readChain(context.tenantId),
        ]);
        const decisionEvents = audit.events.filter((event) => {
          const occurredAt = new Date(event.occurredAt);
          return (!filters.from || occurredAt >= filters.from)
            && (!filters.to || occurredAt <= filters.to)
            && ['WorkPermit', 'ShiftHandover', 'Shift'].includes(event.entity.type);
        });
        rows = [
          ['Тип записи', 'Дата', 'Установка', 'Статус/действие', 'Балл', 'Сущность', 'ID', 'Hash'],
          ...snapshots.map((item) => [
            'READINESS_SNAPSHOT', item.calculatedAt, item.equipmentId, item.status, item.score,
            item.triggerType, item.triggerId, Buffer.from(item.factsHash).toString('hex'),
          ]),
          ...decisionEvents.map((event) => [
            'AUDIT_DECISION', event.occurredAt, '', event.action, '', event.entity.type, event.entity.id, event.hash,
          ]),
        ];
      }

      const csv = buildReadinessCsv({
        dataset,
        timezone,
        generatedAt,
        filters: serializeReadinessFilters(filters),
        rows,
      });
      await recordChainedReadinessAudit(tx, {
        tenantId: context.tenantId,
        action: 'readiness.exported',
        entityType: 'ReadinessExport',
        entityId: dataset + ':' + csv.hash,
        actor: {id: context.actorId, name: context.actorName, role: context.actorRole, actingAs: context.actingAs},
        requestId: context.requestId,
        correlationId: context.correlationId,
        occurredAt: generatedAt,
        after: {dataset, rowCount: Math.max(0, rows.length - 1), sha256: csv.hash, timezone},
        metadata: {filters: serializeReadinessFilters(filters)},
      });
      return {...csv, timezone, rowCount: Math.max(0, rows.length - 1)};
    });

    const filename = 'pilingtrack-readiness-' + dataset + '-' + generatedAt.toISOString().slice(0, 10) + '.csv';
    return new NextResponse(result.body, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="' + filename + '"',
        'cache-control': 'no-store',
        'x-content-sha256': result.hash,
        'x-tenant-timezone': result.timezone,
        'x-export-row-count': String(result.rowCount),
        'x-request-id': context.requestId,
      },
    });
  } catch (error) {
    if (error instanceof ReadinessCommandError) {
      return readinessErrorResponse(error, context.correlationId, context.requestId);
    }
    throw error;
  }
}

export const GET = withApi(handleGet, {domain: 'readiness-export'});
