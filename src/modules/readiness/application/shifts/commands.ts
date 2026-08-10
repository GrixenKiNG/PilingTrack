import type {Prisma} from '@/generated/postgres-client/client';
import {recordChainedReadinessAudit} from '@/core/infrastructure/audit-log-service';
import {effectiveReadinessCapabilities} from '../capabilities';
import {createIdempotencyScope, hashCommandRequest, requireIdempotencyKey} from '../command-pipeline/idempotency';
import {executeIdempotentCommand, type CommandHttpResult} from '../command-pipeline/execute-command';
import {formatStrongEtag, resolveExpectedVersion} from '../command-pipeline/etag';
import {ReadinessCommandError} from '../command-pipeline/errors';
import {requireReworkReason, validateHandoverSummary} from '../../domain/shifts/handover';
import {requireCancellationReason, validateShiftWindow} from '../../domain/shifts/shift';
import {normalizeTenantTimezone, tenantProductionDate} from '../../domain/shifts/tenant-production-date';
import {assertHandoverTransition, assertShiftTransition} from '../../domain/shifts/transitions';
import {PrismaCommandIdempotencyRepository} from '../../infrastructure/command-pipeline/idempotency-repository';
import {HandoverRepository, type HandoverRow} from '../../infrastructure/shifts/handover-repository';
import {ShiftRepository, type ShiftRow} from '../../infrastructure/shifts/shift-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {evaluateAuthoritativeShiftStart} from './start-decision';
import type {CreateShiftPayload, SubmitHandoverPayload, UpdateShiftPayload} from './schemas';
import type {AuditJsonValue} from '../../domain/audit/types';

export interface ShiftCommandContext {
  tenantId: string; actorId: string; actorName: string; actorRole: string;
  actingAs: string | null; requestId: string; correlationId: string;
}

const asAuditJson = (value: unknown): AuditJsonValue => JSON.parse(JSON.stringify(value)) as AuditJsonValue;

export const serializeHandover = (row: HandoverRow) => ({...row,
  evidence: JSON.parse(JSON.stringify(row.evidence)) as AuditJsonValue,
  submittedAt: row.submittedAt?.toISOString() ?? null, acceptedAt: row.acceptedAt?.toISOString() ?? null,
  reworkedAt: row.reworkedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString()});
export const serializeShift = (row: ShiftRow) => ({...row,
  productionDate: row.productionDate.toISOString().slice(0, 10),
  plannedStartAt: row.plannedStartAt?.toISOString() ?? null, plannedEndAt: row.plannedEndAt?.toISOString() ?? null,
  requestedAt: row.requestedAt?.toISOString() ?? null, declinedAt: row.declinedAt?.toISOString() ?? null,
  startedAt: row.startedAt?.toISOString() ?? null, closedAt: row.closedAt?.toISOString() ?? null,
  cancelledAt: row.cancelledAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(), handovers: row.handovers.map(serializeHandover)});

function requireAbility(context: ShiftCommandContext, ability: 'readiness.shift.manage' | 'readiness.handover.prepare' | 'readiness.handover.decide') {
  if (!effectiveReadinessCapabilities(context.actorRole, context.actingAs).has(ability)) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, `Недостаточно прав: ${ability}`);
  }
}

async function runCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; method: 'POST' | 'PATCH';
  routeTemplate: string; aggregateId?: string; key: string | null; body: unknown; expectedVersion?: number;
  execute: (key: string) => Promise<CommandHttpResult>}) {
  const key = requireIdempotencyKey(input.key);
  const scope = createIdempotencyScope({method: input.method, routeTemplate: input.routeTemplate,
    aggregateId: input.aggregateId, actorId: input.context.actorId});
  return executeIdempotentCommand({repository: new PrismaCommandIdempotencyRepository(input.tx),
    tenantId: input.context.tenantId, actorId: input.context.actorId, scope, key,
    requestHash: hashCommandRequest({method: input.method, routeTemplate: input.routeTemplate,
      pathIds: input.aggregateId ? {id: input.aggregateId} : {}, body: input.body,
      expectedVersion: input.expectedVersion, actorId: input.context.actorId}),
    execute: () => input.execute(key)});
}

async function effects(input: {tx: ReadinessTransaction; context: ShiftCommandContext; key: string; action: string;
  entityType: 'Shift' | 'ShiftHandover'; entityId: string; entityVersion: number; equipmentId: string;
  shiftId?: string; triggerOccurredAt: Date; before?: unknown; after: unknown}) {
  await recordChainedReadinessAudit(input.tx, {tenantId: input.context.tenantId,
    action: `${input.entityType === 'Shift' ? 'shift' : 'handover'}.${input.action}`,
    entityType: input.entityType, entityId: input.entityId, entityVersion: input.entityVersion,
    actor: {id: input.context.actorId, name: input.context.actorName, role: input.context.actorRole,
      actingAs: input.context.actingAs}, requestId: input.context.requestId,
    correlationId: input.context.correlationId, idempotencyKey: input.key,
    before: input.before, after: input.after});
  // createMany со skipDuplicates, а не create: дубль dedupeKey означает
  // «снимок по этому же триггеру уже заказан» — ровно то, ради чего ключ и
  // заведён, и это не ошибка. Перехватить P2002 в try/catch нельзя: в
  // Postgres упавший запрос отменяет всю транзакцию, и следующая команда
  // всё равно упала бы. ON CONFLICT DO NOTHING оставляет транзакцию живой.
  //
  // Заблокированный запуск — единственное действие, которое не меняет версию
  // смены, поэтому повторная попытка запустить ту же заблокированную смену
  // давала тот же ключ. Раньше это всплывало наружу сырой ошибкой Prisma с
  // путём к файлу сервера вместо «запуск запрещён правилами готовности».
  await input.tx.outboxEvent.createMany({skipDuplicates: true,
    data: [{type: 'ReadinessSnapshotRequested', tenantId: input.context.tenantId,
      aggregateId: input.entityId, aggregateType: input.entityType,
      dedupeKey: `readiness.snapshot:${input.context.tenantId}:${input.equipmentId}:${input.entityType.toUpperCase()}_${input.action.toUpperCase()}:${input.entityId}:v${input.entityVersion}`,
      payload: {triggerType: `${input.entityType.toUpperCase()}_${input.action.toUpperCase()}`,
        triggerId: `${input.entityId}:v${input.entityVersion}:${input.action}`, equipmentId: input.equipmentId,
        shiftId: input.shiftId ?? (input.entityType === 'Shift' ? input.entityId : undefined),
        triggerOccurredAt: input.triggerOccurredAt.toISOString()} as Prisma.InputJsonValue}]});
}

export function createShiftCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; key: string | null;
  payload: CreateShiftPayload; now?: Date}) {
  requireAbility(input.context, 'readiness.shift.manage');
  return runCommand({tx: input.tx, context: input.context, method: 'POST', routeTemplate: '/api/readiness/shifts',
    key: input.key, body: input.payload, execute: async (key) => {
      const repo = new ShiftRepository(input.tx); const now = input.now ?? new Date();
      await repo.requireActor(input.context.tenantId, input.context.actorId);
      await repo.requireEquipment(input.context.tenantId, input.payload.equipmentId);
      const timezone = normalizeTenantTimezone(await repo.tenantTimezone(input.context.tenantId));
      const plannedStartAt = input.payload.plannedStartAt ? new Date(input.payload.plannedStartAt) : null;
      const plannedEndAt = input.payload.plannedEndAt ? new Date(input.payload.plannedEndAt) : null;
      validateShiftWindow(plannedStartAt, plannedEndAt);
      const row = await repo.create({tenantId: input.context.tenantId, equipmentId: input.payload.equipmentId,
        type: input.payload.type, productionDate: tenantProductionDate(now, timezone), timezone,
        plannedStartAt, plannedEndAt, actorId: input.context.actorId});
      const after = serializeShift(row); await effects({tx: input.tx, context: input.context, key, action: 'created',
        entityType: 'Shift', entityId: row.id, entityVersion: row.version, equipmentId: row.equipmentId,
        triggerOccurredAt: row.createdAt, after});
      return {status: 201, body: {data: after}, headers: {ETag: formatStrongEtag('shift', row.id, row.version),
        Location: `/api/readiness/shifts/${row.id}`}};
    }});
}

export function updateShiftCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; id: string;
  key: string | null; ifMatch: string | null; payload: UpdateShiftPayload}) {
  requireAbility(input.context, 'readiness.shift.manage');
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch, expectedVersion: input.payload.expectedVersion,
    kind: 'shift', id: input.id});
  return runCommand({tx: input.tx, context: input.context, method: 'PATCH', routeTemplate: '/api/readiness/shifts/:id',
    aggregateId: input.id, key: input.key, body: input.payload, expectedVersion: expected, execute: async (key) => {
      const repo = new ShiftRepository(input.tx); const beforeRow = await repo.get(input.context.tenantId, input.id);
      assertShiftTransition(beforeRow.state, 'edit');
      const start = input.payload.plannedStartAt === undefined ? beforeRow.plannedStartAt
        : input.payload.plannedStartAt ? new Date(input.payload.plannedStartAt) : null;
      const end = input.payload.plannedEndAt === undefined ? beforeRow.plannedEndAt
        : input.payload.plannedEndAt ? new Date(input.payload.plannedEndAt) : null;
      validateShiftWindow(start, end);
      const row = await repo.updatePlanned({tenantId: input.context.tenantId, id: input.id,
        expectedVersion: expected, actorId: input.context.actorId, type: input.payload.type,
        plannedStartAt: input.payload.plannedStartAt === undefined ? undefined : start,
        plannedEndAt: input.payload.plannedEndAt === undefined ? undefined : end});
      const after = serializeShift(row); await effects({tx: input.tx, context: input.context, key, action: 'updated',
        entityType: 'Shift', entityId: row.id, entityVersion: row.version, equipmentId: row.equipmentId,
        triggerOccurredAt: row.updatedAt, before: serializeShift(beforeRow), after});
      return {status: 200, body: {data: after}, headers: {ETag: formatStrongEtag('shift', row.id, row.version)}};
    }});
}

export function startShiftCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; id: string;
  key: string | null; ifMatch: string | null; expectedVersion?: number; now?: Date}) {
  // Запуск — решение принимающей стороны, а не того, кто готовил установку.
  requireAbility(input.context, 'readiness.handover.decide');
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch, expectedVersion: input.expectedVersion,
    kind: 'shift', id: input.id});
  return runCommand({tx: input.tx, context: input.context, method: 'POST', routeTemplate: '/api/readiness/shifts/:id/start',
    aggregateId: input.id, key: input.key, body: {expectedVersion: input.expectedVersion ?? null}, expectedVersion: expected,
    execute: async (key) => {
      const repo = new ShiftRepository(input.tx); const beforeRow = await repo.get(input.context.tenantId, input.id);
      if (beforeRow.version !== expected) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Смена изменилась. Обновите страницу и повторите действие',
        {current: serializeShift(beforeRow)});
      assertShiftTransition(beforeRow.state, 'start'); const now = input.now ?? new Date();
      const decision = await evaluateAuthoritativeShiftStart({tx: input.tx, tenantId: input.context.tenantId,
        equipmentId: beforeRow.equipmentId, shiftId: beforeRow.id, now, timezone: beforeRow.timezone});
      if (!decision.allowed) {
        await effects({tx: input.tx, context: input.context, key, action: 'start-blocked', entityType: 'Shift',
          entityId: beforeRow.id, entityVersion: beforeRow.version, equipmentId: beforeRow.equipmentId,
          triggerOccurredAt: now, before: serializeShift(beforeRow), after: {shift: serializeShift(beforeRow), decision}});
        return {status: 422, body: asAuditJson({error: {code: 'SHIFT_START_BLOCKED', message: 'Запуск смены запрещён действующими правилами готовности',
          details: {blockers: decision.blockers, warnings: decision.warnings, snapshotId: decision.snapshotId}}})};
      }
      const row = await repo.start(input.context.tenantId, input.id, expected, input.context.actorId, now);
      const after = serializeShift(row); await effects({tx: input.tx, context: input.context, key, action: 'started',
        entityType: 'Shift', entityId: row.id, entityVersion: row.version, equipmentId: row.equipmentId,
        triggerOccurredAt: row.startedAt ?? now, before: serializeShift(beforeRow), after: {shift: after, decision}});
      return {status: 200, body: asAuditJson({data: after, decision}), headers: {ETag: formatStrongEtag('shift', row.id, row.version)}};
    }});
}

export function requestShiftAcceptanceCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext;
  id: string; key: string | null; ifMatch: string | null; expectedVersion?: number; now?: Date}) {
  requireAbility(input.context, 'readiness.shift.manage');
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch, expectedVersion: input.expectedVersion,
    kind: 'shift', id: input.id});
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: '/api/readiness/shifts/:id/request-acceptance', aggregateId: input.id, key: input.key,
    body: {expectedVersion: input.expectedVersion ?? null}, expectedVersion: expected, execute: async (key) => {
      const repo = new ShiftRepository(input.tx); const before = await repo.get(input.context.tenantId, input.id);
      assertShiftTransition(before.state, 'request'); const now = input.now ?? new Date();
      const row = await repo.requestAcceptance(input.context.tenantId, input.id, expected, input.context.actorId, now);
      const after = serializeShift(row);
      await effects({tx: input.tx, context: input.context, key, action: 'acceptance-requested', entityType: 'Shift',
        entityId: row.id, entityVersion: row.version, equipmentId: row.equipmentId,
        triggerOccurredAt: row.requestedAt ?? now, before: serializeShift(before), after});
      return {status: 200, body: {data: after}, headers: {ETag: formatStrongEtag('shift', row.id, row.version)}};
    }});
}

export function declineShiftCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; id: string;
  key: string | null; ifMatch: string | null; expectedVersion?: number; reason: string; now?: Date}) {
  requireAbility(input.context, 'readiness.handover.decide');
  const expected = resolveExpectedVersion({ifMatch: input.ifMatch, expectedVersion: input.expectedVersion,
    kind: 'shift', id: input.id});
  const reason = requireCancellationReason(input.reason);
  return runCommand({tx: input.tx, context: input.context, method: 'POST',
    routeTemplate: '/api/readiness/shifts/:id/decline', aggregateId: input.id, key: input.key,
    body: {expectedVersion: input.expectedVersion, reason}, expectedVersion: expected, execute: async (key) => {
      const repo = new ShiftRepository(input.tx); const before = await repo.get(input.context.tenantId, input.id);
      assertShiftTransition(before.state, 'decline'); const now = input.now ?? new Date();
      const row = await repo.decline({tenantId: input.context.tenantId, id: input.id, version: expected,
        actorId: input.context.actorId, reason, now});
      const after = serializeShift(row);
      await effects({tx: input.tx, context: input.context, key, action: 'acceptance-declined', entityType: 'Shift',
        entityId: row.id, entityVersion: row.version, equipmentId: row.equipmentId,
        triggerOccurredAt: row.declinedAt ?? now, before: serializeShift(before), after});
      return {status: 200, body: {data: after}, headers: {ETag: formatStrongEtag('shift', row.id, row.version)}};
    }});
}

export function cancelShiftCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; id: string;
  key: string | null; ifMatch: string | null; expectedVersion?: number; reason: string; now?: Date}) {
  requireAbility(input.context, 'readiness.shift.manage'); const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.expectedVersion, kind: 'shift', id: input.id}); const reason = requireCancellationReason(input.reason);
  return runCommand({tx: input.tx, context: input.context, method: 'POST', routeTemplate: '/api/readiness/shifts/:id/cancel',
    aggregateId: input.id, key: input.key, body: {expectedVersion: input.expectedVersion, reason}, expectedVersion: expected,
    execute: async (key) => { const repo = new ShiftRepository(input.tx); const before = await repo.get(input.context.tenantId, input.id);
      assertShiftTransition(before.state, 'cancel'); const row = await repo.cancel({tenantId: input.context.tenantId, id: input.id,
        version: expected, actorId: input.context.actorId, reason, now: input.now ?? new Date()}); const after = serializeShift(row);
      await effects({tx: input.tx, context: input.context, key, action: 'cancelled', entityType: 'Shift', entityId: row.id,
        entityVersion: row.version, equipmentId: row.equipmentId, triggerOccurredAt: row.cancelledAt ?? row.updatedAt,
        before: serializeShift(before), after});
      return {status: 200, body: {data: after}, headers: {ETag: formatStrongEtag('shift', row.id, row.version)}};}});
}

export function submitHandoverCommand(input: {tx: ReadinessTransaction; context: ShiftCommandContext; shiftId: string;
  key: string | null; ifMatch: string | null; payload: SubmitHandoverPayload; now?: Date}) {
  requireAbility(input.context, 'readiness.handover.prepare'); const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.payload.expectedVersion, kind: 'shift', id: input.shiftId});
  return runCommand({tx: input.tx, context: input.context, method: 'POST', routeTemplate: '/api/readiness/shifts/:id/handover',
    aggregateId: input.shiftId, key: input.key, body: input.payload, expectedVersion: expected, execute: async (key) => {
      const shifts = new ShiftRepository(input.tx); const handovers = new HandoverRepository(input.tx);
      const before = await shifts.get(input.context.tenantId, input.shiftId); assertShiftTransition(before.state, 'handover');
      const now = input.now ?? new Date();
      const summary = validateHandoverSummary(input.payload.summary);
      const evidence = (input.payload.evidence ?? {}) as Prisma.InputJsonValue;
      // Возвращённую на доработку передачу переоформляем той же записью:
      // состояние REWORK_REQUIRED домен считает пригодным для повторной
      // передачи, а второй живой строки по смене индекс не разрешает.
      const live = await handovers.findLive(input.context.tenantId, input.shiftId);
      const reworked = live?.state === 'REWORK_REQUIRED' ? live : null;
      if (reworked) assertHandoverTransition(reworked.state, 'submit');
      const handover = reworked
        ? await handovers.resubmit({tenantId: input.context.tenantId, id: reworked.id,
          version: reworked.version, summary, evidence, actorId: input.context.actorId, now})
        : await handovers.createSubmitted({tenantId: input.context.tenantId,
          shiftId: input.shiftId, summary, evidence, actorId: input.context.actorId, now});
      const shift = await shifts.markHandoverPending(input.context.tenantId, input.shiftId, expected);
      const after = serializeHandover(handover); await effects({tx: input.tx, context: input.context, key,
        action: reworked ? 'resubmitted' : 'submitted', entityType: 'ShiftHandover', entityId: handover.id,
        entityVersion: handover.version,
        equipmentId: shift.equipmentId, shiftId: shift.id, triggerOccurredAt: handover.submittedAt ?? now,
        before: reworked ? serializeHandover(reworked) : null, after});
      return {status: 201, body: {data: after, shift: serializeShift(shift)},
        headers: {ETag: formatStrongEtag('handover', handover.id, handover.version), Location: `/api/readiness/handovers/${handover.id}`}};
    }});
}

async function decideHandover(input: {tx: ReadinessTransaction; context: ShiftCommandContext; id: string;
  key: string | null; ifMatch: string | null; expectedVersion?: number; action: 'accept' | 'rework'; reason?: string; now?: Date}) {
  requireAbility(input.context, 'readiness.handover.decide'); const expected = resolveExpectedVersion({ifMatch: input.ifMatch,
    expectedVersion: input.expectedVersion, kind: 'handover', id: input.id});
  const commandBody = input.action === 'rework'
    ? {expectedVersion: input.expectedVersion ?? null, reason: input.reason}
    : {expectedVersion: input.expectedVersion ?? null};
  return runCommand({tx: input.tx, context: input.context, method: 'POST', routeTemplate: `/api/readiness/handovers/:id/${input.action}`,
    aggregateId: input.id, key: input.key, body: commandBody, expectedVersion: expected,
    execute: async (key) => { const handovers = new HandoverRepository(input.tx); const shifts = new ShiftRepository(input.tx);
      const before = await handovers.get(input.context.tenantId, input.id);
      if (before.version !== expected || before.state !== 'SUBMITTED') {
        throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Передача изменилась. Обновите страницу и повторите действие',
          {current: serializeHandover(before)});
      }
      assertHandoverTransition(before.state, input.action);
      const shiftBefore = await shifts.get(input.context.tenantId, before.shiftId); const now = input.now ?? new Date();
      const handover = input.action === 'accept'
        ? await handovers.accept({tenantId: input.context.tenantId, id: input.id, version: expected,
          actorId: input.context.actorId, now})
        : await handovers.rework({tenantId: input.context.tenantId, id: input.id, version: expected,
          actorId: input.context.actorId, reason: requireReworkReason(input.reason!), now});
      const shift = input.action === 'accept'
        ? await shifts.close(input.context.tenantId, shiftBefore.id, shiftBefore.version, input.context.actorId, now)
        : await shifts.reopen(input.context.tenantId, shiftBefore.id, shiftBefore.version);
      const after = serializeHandover(handover); await effects({tx: input.tx, context: input.context, key,
        action: input.action === 'accept' ? 'accepted' : 'rework-requested', entityType: 'ShiftHandover',
        entityId: handover.id, entityVersion: handover.version, equipmentId: shift.equipmentId,
        shiftId: shift.id, triggerOccurredAt: handover.acceptedAt ?? handover.reworkedAt ?? now,
        before: serializeHandover(before), after});
      return {status: 200, body: {data: after, shift: serializeShift(shift)},
        headers: {ETag: formatStrongEtag('handover', handover.id, handover.version)}};}});
}

export const acceptHandoverCommand = (input: Omit<Parameters<typeof decideHandover>[0], 'action' | 'reason'>) =>
  decideHandover({...input, action: 'accept'});
export const reworkHandoverCommand = (input: Omit<Parameters<typeof decideHandover>[0], 'action'> & {reason: string}) =>
  decideHandover({...input, action: 'rework'});
