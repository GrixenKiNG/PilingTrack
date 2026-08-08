import type {Prisma} from '@/generated/postgres-client/client';
import {recordChainedReadinessAudit} from '@/core/infrastructure/audit-log-service';
import {resolveReadinessCapabilities} from '../capabilities';
import {createIdempotencyScope, hashCommandRequest, requireIdempotencyKey} from '../command-pipeline/idempotency';
import {executeIdempotentCommand, type CommandHttpResult} from '../command-pipeline/execute-command';
import {formatStrongEtag, resolveExpectedVersion} from '../command-pipeline/etag';
import {ReadinessCommandError} from '../command-pipeline/errors';
import {transitionDefect} from '../../domain/defects/defect';
import {PrismaCommandIdempotencyRepository} from '../../infrastructure/command-pipeline/idempotency-repository';
import {DefectRepository, toDefectRecord, type DefectRow} from '../../infrastructure/defects/defect-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import type {
  CreateDefectPayload, RejectDefectPayload, ResolveDefectPayload, TriageDefectPayload,
} from './schemas';

export interface DefectCommandContext {
  tenantId: string; actorId: string; actorName: string; actorRole: string;
  actingAs: string | null; requestId: string; correlationId: string;
}

export const serializeDefect = (row: DefectRow) => ({
  id: row.id,
  equipmentId: row.equipmentId,
  severity: row.severity,
  status: row.status,
  title: row.title,
  description: row.description,
  node: row.node,
  reportedById: row.reportedById,
  reportedAt: row.reportedAt.toISOString(),
  inspectionId: row.inspectionId,
  shiftId: row.shiftId,
  triagedById: row.triagedById,
  triagedAt: row.triagedAt?.toISOString() ?? null,
  maintenanceRecordId: row.maintenanceRecordId,
  resolvedById: row.resolvedById,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  resolution: row.resolution,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Зафиксировать дефект может любой, кто работает со сменой: оператор в поле,
 * помощник, диспетчер. Замечание не должно упираться в права — потерянная
 * неисправность дороже лишней записи.
 */
function assertCanReport(context: DefectCommandContext): void {
  if (!resolveReadinessCapabilities(context.actorRole).has('readiness.defect.report')) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Defect report capability is required');
  }
}

/** Разбирать, закрывать и отклонять — только диспетчер, механик, администратор. */
function assertCanManage(context: DefectCommandContext): void {
  const direct = resolveReadinessCapabilities(context.actorRole).has('readiness.defect.manage');
  const adminAsMechanic = context.actorRole === 'ADMIN' && context.actingAs === 'MECHANIC';
  if (!direct && !adminAsMechanic) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Defect manage capability is required');
  }
}

async function emitEffects(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; action: string;
  before?: unknown; row: DefectRow; key: string;
}) {
  await recordChainedReadinessAudit(input.tx, {
    tenantId: input.context.tenantId, action: `defect.${input.action}`,
    entityType: 'EquipmentDefect', entityId: input.row.id, entityVersion: input.row.version,
    actor: {id: input.context.actorId, name: input.context.actorName,
      role: input.context.actorRole, actingAs: input.context.actingAs},
    requestId: input.context.requestId, correlationId: input.context.correlationId,
    idempotencyKey: input.key, before: input.before, after: serializeDefect(input.row),
  });
  // Готовность зависит от открытых критических дефектов, поэтому любое
  // изменение журнала просит пересчитать снимок установки.
  const triggerId = `${input.row.id}:v${input.row.version}:${input.action}`;
  await input.tx.outboxEvent.create({data: {
    type: 'ReadinessSnapshotRequested', aggregateId: input.row.id,
    aggregateType: 'EquipmentDefect', tenantId: input.context.tenantId,
    dedupeKey: `readiness.snapshot:${input.context.tenantId}:${input.row.equipmentId}:DEFECT_CHANGED:${triggerId}`,
    payload: {triggerType: 'DEFECT_CHANGED', triggerId, equipmentId: input.row.equipmentId,
      defectId: input.row.id, severity: input.row.severity, status: input.row.status,
      triggerOccurredAt: new Date().toISOString()} as Prisma.InputJsonValue,
  }});
}

async function runCommand(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; method: 'POST';
  routeTemplate: string; aggregateId?: string; key: string | null; body: unknown;
  expectedVersion?: number; execute: (key: string) => Promise<CommandHttpResult>;
}): Promise<CommandHttpResult> {
  const key = requireIdempotencyKey(input.key);
  const scope = createIdempotencyScope({method: input.method,
    routeTemplate: input.routeTemplate, aggregateId: input.aggregateId,
    actorId: input.context.actorId});
  return executeIdempotentCommand({
    repository: new PrismaCommandIdempotencyRepository(input.tx),
    tenantId: input.context.tenantId, actorId: input.context.actorId, scope, key,
    requestHash: hashCommandRequest({method: input.method,
      routeTemplate: input.routeTemplate,
      pathIds: input.aggregateId ? {id: input.aggregateId} : {},
      body: input.body, expectedVersion: input.expectedVersion,
      actorId: input.context.actorId}),
    execute: () => input.execute(key),
  });
}

export async function createDefectCommand(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; key: string | null;
  payload: CreateDefectPayload;
}): Promise<CommandHttpResult> {
  assertCanReport(input.context);
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: '/api/readiness/defects', key: input.key, body: input.payload,
    execute: async (key) => {
      const repository = new DefectRepository(input.tx);
      await repository.requireActor(input.context.tenantId, input.context.actorId);
      await repository.requireEquipment(input.context.tenantId, input.payload.equipmentId);
      const row = await repository.create({
        tenantId: input.context.tenantId,
        equipmentId: input.payload.equipmentId,
        severity: input.payload.severity,
        title: input.payload.title,
        description: input.payload.description ?? '',
        node: input.payload.node ?? null,
        inspectionId: input.payload.inspectionId ?? null,
        shiftId: input.payload.shiftId ?? null,
        actorId: input.context.actorId,
      });
      await emitEffects({tx: input.tx, context: input.context, action: 'reported', row, key});
      return {status: 201, body: {data: serializeDefect(row)},
        headers: {ETag: formatStrongEtag('defect', row.id, row.version),
          Location: `/api/readiness/defects/${row.id}`}};
    }});
}

/** Общая часть разбора и закрытия: проверка версии и допустимости перехода. */
async function versionedAction(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; id: string; key: string | null;
  ifMatch: string | null; expectedVersion?: number;
  action: 'triage' | 'resolve' | 'reject'; body: unknown;
  apply: (args: {repository: DefectRepository; expected: number; before: DefectRow}) => Promise<DefectRow>;
}): Promise<CommandHttpResult> {
  assertCanManage(input.context);
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.expectedVersion, kind: 'defect', id: input.id});
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: `/api/readiness/defects/:id/${input.action}`, aggregateId: input.id,
    key: input.key, body: input.body, expectedVersion: expected,
    execute: async (key) => {
      const repository = new DefectRepository(input.tx);
      const before = await repository.get(input.context.tenantId, input.id);
      const record = toDefectRecord(before);
      if (record.version !== expected) {
        throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Defect version conflict');
      }
      const row = await input.apply({repository, expected, before});
      await emitEffects({tx: input.tx, context: input.context, action: input.action,
        before: serializeDefect(before), row, key});
      return {status: 200, body: {data: serializeDefect(row)},
        headers: {ETag: formatStrongEtag('defect', row.id, row.version)}};
    }});
}

export async function triageDefectCommand(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; id: string; key: string | null;
  ifMatch: string | null; payload: TriageDefectPayload;
}): Promise<CommandHttpResult> {
  return versionedAction({...input, action: 'triage', body: input.payload,
    expectedVersion: input.payload.expectedVersion,
    apply: async ({repository, expected, before}) => {
      const status = transitionDefect(before.status, 'TRIAGE');
      if (!status) {
        throw new ReadinessCommandError('VALIDATION_ERROR', 409, 'Defect is already closed');
      }
      if (input.payload.maintenanceRecordId) {
        await repository.requireMaintenanceRecord({tenantId: input.context.tenantId,
          id: input.payload.maintenanceRecordId, equipmentId: before.equipmentId});
      }
      return repository.triage({tenantId: input.context.tenantId, id: input.id,
        expectedVersion: expected, actorId: input.context.actorId, status,
        severity: input.payload.severity,
        maintenanceRecordId: input.payload.maintenanceRecordId});
    }});
}

export async function resolveDefectCommand(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; id: string; key: string | null;
  ifMatch: string | null; payload: ResolveDefectPayload;
}): Promise<CommandHttpResult> {
  return versionedAction({...input, action: 'resolve', body: input.payload,
    expectedVersion: input.payload.expectedVersion,
    apply: async ({repository, expected, before}) => {
      const status = transitionDefect(before.status, 'RESOLVE');
      if (!status) {
        throw new ReadinessCommandError('VALIDATION_ERROR', 409,
          'Defect must be taken into work before it can be closed');
      }
      return repository.close({tenantId: input.context.tenantId, id: input.id,
        expectedVersion: expected, actorId: input.context.actorId,
        status: 'CLOSED', resolution: input.payload.resolution});
    }});
}

export async function rejectDefectCommand(input: {
  tx: ReadinessTransaction; context: DefectCommandContext; id: string; key: string | null;
  ifMatch: string | null; payload: RejectDefectPayload;
}): Promise<CommandHttpResult> {
  return versionedAction({...input, action: 'reject', body: input.payload,
    expectedVersion: input.payload.expectedVersion,
    apply: async ({repository, expected, before}) => {
      const status = transitionDefect(before.status, 'REJECT');
      if (!status) {
        throw new ReadinessCommandError('VALIDATION_ERROR', 409,
          'Only an untriaged defect can be rejected');
      }
      return repository.close({tenantId: input.context.tenantId, id: input.id,
        expectedVersion: expected, actorId: input.context.actorId,
        status: 'REJECTED', resolution: input.payload.reason});
    }});
}
