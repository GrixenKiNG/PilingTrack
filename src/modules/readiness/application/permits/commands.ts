import type {Prisma} from '@/generated/postgres-client/client';
import {recordChainedReadinessAudit} from '@/core/infrastructure/audit-log-service';
import {resolveReadinessCapabilities} from '../capabilities';
import {createIdempotencyScope, hashCommandRequest, requireIdempotencyKey} from '../command-pipeline/idempotency';
import {executeIdempotentCommand, type CommandHttpResult} from '../command-pipeline/execute-command';
import {resolveExpectedVersion, formatStrongEtag} from '../command-pipeline/etag';
import {ReadinessCommandError} from '../command-pipeline/errors';
import {assertCanApprovePermit, isApprovalComplete} from '../../domain/permits/approval-policy';
import {editPermit, validatePermitContent} from '../../domain/permits/work-permit';
import {assertPermitTransition} from '../../domain/permits/transitions';
import {PrismaCommandIdempotencyRepository} from '../../infrastructure/command-pipeline/idempotency-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {toWorkPermitRecord, WorkPermitRepository} from '../../infrastructure/permits/work-permit-repository';
import type {CreateWorkPermitPayload, UpdateWorkPermitPayload} from './schemas';

export interface PermitCommandContext {
  tenantId: string; actorId: string; actorName: string; actorRole: string;
  actingAs: string | null; requestId: string; correlationId: string;
}

type PermitRow = Awaited<ReturnType<WorkPermitRepository['get']>>;

export const serializePermit = (row: PermitRow) => ({
  id: row.id, equipmentId: row.equipmentId, shiftId: row.shiftId, risk: row.risk,
  state: row.state, scope: row.scope, validFrom: row.validFrom.toISOString(),
  validTo: row.validTo.toISOString(), timezone: row.timezone, version: row.version,
  authorId: row.authorId, lastEditedById: row.lastEditedById,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null, revokeReason: row.revokeReason,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  approvals: row.approvals.map((item) => ({
    role: item.role, approvedById: item.approvedById,
    approvedAt: item.approvedAt.toISOString(), valid: item.valid,
    permitVersion: item.permitVersion,
  })),
});

function assertPermitEditor(context: PermitCommandContext): void {
  const direct = resolveReadinessCapabilities(context.actorRole).has('readiness.permit.edit');
  const adminAsMechanic = context.actorRole === 'ADMIN' && context.actingAs === 'MECHANIC';
  if (!direct && !adminAsMechanic) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Нет права редактировать наряд-допуск');
  }
}

async function emitEffects(input: {
  tx: ReadinessTransaction; context: PermitCommandContext; action: string;
  before?: unknown; row: PermitRow; key: string;
}) {
  const after = serializePermit(input.row);
  await recordChainedReadinessAudit(input.tx, {
    tenantId: input.context.tenantId, action: `work-permit.${input.action}`,
    entityType: 'WorkPermit', entityId: input.row.id, entityVersion: input.row.version,
    actor: {id: input.context.actorId, name: input.context.actorName,
      role: input.context.actorRole, actingAs: input.context.actingAs},
    requestId: input.context.requestId, correlationId: input.context.correlationId,
    idempotencyKey: input.key, before: input.before, after,
  });
  const triggerId = `${input.row.id}:v${input.row.version}:${input.action}`;
  await input.tx.outboxEvent.create({data: {
    type: 'ReadinessSnapshotRequested', aggregateId: input.row.id,
    aggregateType: 'WorkPermit', tenantId: input.context.tenantId,
    dedupeKey: `readiness.snapshot:${input.context.tenantId}:${input.row.equipmentId}:WORK_PERMIT_CHANGED:${triggerId}`,
    payload: {triggerType: 'WORK_PERMIT_CHANGED', triggerId,
      equipmentId: input.row.equipmentId, permitId: input.row.id,
      state: input.row.state, triggerOccurredAt: new Date().toISOString()} as Prisma.InputJsonValue,
  }});
}

async function runCommand(input: {
  tx: ReadinessTransaction; context: PermitCommandContext; method: 'POST' | 'PATCH';
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
      routeTemplate: input.routeTemplate, pathIds: input.aggregateId ? {id: input.aggregateId} : {},
      body: input.body, expectedVersion: input.expectedVersion, actorId: input.context.actorId}),
    execute: () => input.execute(key),
  });
}

export async function createWorkPermitCommand(input: {
  tx: ReadinessTransaction; context: PermitCommandContext; key: string | null;
  payload: CreateWorkPermitPayload;
}): Promise<CommandHttpResult> {
  assertPermitEditor(input.context);
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: '/api/readiness/work-permits', key: input.key, body: input.payload,
    execute: async (key) => {
      const repository = new WorkPermitRepository(input.tx);
      await repository.requireActor(input.context.tenantId, input.context.actorId);
      await repository.requireEquipment(input.context.tenantId, input.payload.equipmentId);
      const timezone = await repository.tenantTimezone(input.context.tenantId);
      const content = validatePermitContent({...input.payload,
        validFrom: new Date(input.payload.validFrom), validTo: new Date(input.payload.validTo)});
      const row = await repository.create({...content, tenantId: input.context.tenantId,
        timezone, actorId: input.context.actorId});
      await emitEffects({tx: input.tx, context: input.context, action: 'created', row, key});
      return {status: 201, body: {data: serializePermit(row)},
        headers: {ETag: formatStrongEtag('work-permit', row.id, row.version),
          Location: `/api/readiness/work-permits/${row.id}`}};
    }});
}

export async function updateWorkPermitCommand(input: {
  tx: ReadinessTransaction; context: PermitCommandContext; id: string; key: string | null;
  ifMatch: string | null; payload: UpdateWorkPermitPayload;
}): Promise<CommandHttpResult> {
  assertPermitEditor(input.context);
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.payload.expectedVersion, kind: 'work-permit', id: input.id});
  return runCommand({tx: input.tx, context: input.context, method: 'PATCH',
    routeTemplate: '/api/readiness/work-permits/:id', aggregateId: input.id,
    key: input.key, body: input.payload, expectedVersion: expected,
    execute: async (key) => {
      const repository = new WorkPermitRepository(input.tx);
      const beforeRow = await repository.get(input.context.tenantId, input.id);
      const permit = toWorkPermitRecord(beforeRow);
      if (permit.version !== expected) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Наряд изменился. Обновите страницу и повторите действие');
      if (input.payload.equipmentId) await repository.requireEquipment(input.context.tenantId, input.payload.equipmentId);
      const edit = editPermit(permit, {...input.payload,
        validFrom: input.payload.validFrom ? new Date(input.payload.validFrom) : undefined,
        validTo: input.payload.validTo ? new Date(input.payload.validTo) : undefined}, input.context.actorId);
      const row = await repository.updateContent({tenantId: input.context.tenantId,
        id: input.id, expectedVersion: expected, actorId: input.context.actorId,
        content: edit.content, nextVersion: edit.version,
        invalidateApprovals: edit.invalidatesApprovals});
      await emitEffects({tx: input.tx, context: input.context, action: 'updated',
        before: serializePermit(beforeRow), row, key});
      return {status: 200, body: {data: serializePermit(row)},
        headers: {ETag: formatStrongEtag('work-permit', row.id, row.version)}};
    }});
}

async function versionedAction(input: {
  tx: ReadinessTransaction; context: PermitCommandContext; id: string; key: string | null;
  ifMatch: string | null; expectedVersion?: number; action: 'submit' | 'approve' | 'revoke';
  reason?: string;
}): Promise<CommandHttpResult> {
  if (input.action !== 'approve') assertPermitEditor(input.context);
  if (input.action === 'approve' && input.context.actingAs) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'В режиме замещения согласовывать наряды нельзя');
  }
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.expectedVersion, kind: 'work-permit', id: input.id});
  const body = input.action === 'revoke'
    ? {expectedVersion: input.expectedVersion ?? null, reason: input.reason}
    : {expectedVersion: input.expectedVersion ?? null};
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: `/api/readiness/work-permits/:id/${input.action}`,
    aggregateId: input.id, key: input.key, body, expectedVersion: expected,
    execute: async (key) => {
      const repository = new WorkPermitRepository(input.tx);
      await repository.requireActor(input.context.tenantId, input.context.actorId);
      const beforeRow = await repository.get(input.context.tenantId, input.id);
      const before = serializePermit(beforeRow);
      if (beforeRow.version !== expected) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Наряд изменился. Обновите страницу и повторите действие');
      let row: PermitRow;
      let eventAction: string = input.action;
      if (input.action === 'submit') {
        assertPermitTransition(beforeRow.state, 'submit');
        row = await repository.submit(input.context.tenantId, input.id, expected);
      } else if (input.action === 'revoke') {
        assertPermitTransition(beforeRow.state, 'revoke');
        row = await repository.revoke({tenantId: input.context.tenantId,
          id: input.id, version: expected, actorId: input.context.actorId,
          reason: input.reason!});
      } else {
        const permit = toWorkPermitRecord(beforeRow);
        assertPermitTransition(permit.state, 'approve');
        if (beforeRow.validTo <= new Date()) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Просроченный наряд согласовать нельзя');
        const role = assertCanApprovePermit({permit, actorId: input.context.actorId,
          role: input.context.actorRole, approvals: permit.approvals});
        await repository.addApproval({tenantId: input.context.tenantId,
          permitId: input.id, permitVersion: expected, role,
          actorId: input.context.actorId});
        row = await repository.get(input.context.tenantId, input.id);
        if (isApprovalComplete(row.risk, toWorkPermitRecord(row).approvals, row.version)) {
          row = await repository.markApproved(input.context.tenantId, input.id, expected);
        }
        eventAction = `approved-${role.toLowerCase()}`;
      }
      await emitEffects({tx: input.tx, context: input.context,
        action: eventAction, before, row, key});
      return {status: 200, body: {data: serializePermit(row)},
        headers: {ETag: formatStrongEtag('work-permit', row.id, row.version)}};
    }});
}

export const submitWorkPermitCommand = (input: Omit<Parameters<typeof versionedAction>[0], 'action' | 'reason'>) =>
  versionedAction({...input, action: 'submit'});
export const approveWorkPermitCommand = (input: Omit<Parameters<typeof versionedAction>[0], 'action' | 'reason'>) =>
  versionedAction({...input, action: 'approve'});
export const revokeWorkPermitCommand = (input: Omit<Parameters<typeof versionedAction>[0], 'action'> & {reason: string}) =>
  versionedAction({...input, action: 'revoke'});
