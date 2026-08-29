import type {Prisma} from '@/generated/postgres-client/client';
import {recordMeterReadingInTx} from '@/modules/equipment/application/commands/meter-reading';
import {composeChecklist, requiredBlockTypes, selectBlocks, type CandidateBlock} from '@/modules/inspections/domain/block-composition';
import {computeHealthScore, findMissing, type AnswerLike, type SnapItem} from '@/modules/inspections/domain/inspection-logic';
import {itemsForPhase, type ShiftInspectionPhase} from '@/modules/inspections/domain/phase-split';
import {formatStrongEtag} from '@/modules/readiness/application/command-pipeline/etag';
import {startShiftCommand} from '@/modules/readiness/application/shifts/commands';
import {normalizeTenantTimezone, tenantProductionDate} from '@/modules/readiness/domain/shifts/tenant-production-date';
import {recordChainedReadinessAudit} from '@/modules/readiness/infrastructure/audit/record-audit';
import {ShiftRepository} from '@/modules/readiness/infrastructure/shifts/shift-repository';
import {OperatorChecklistRepository} from '@/modules/operator-v3/infrastructure/operator-checklist-repository';
import {OperatorShiftEvidenceRepository} from '@/modules/operator-v3/infrastructure/operator-shift-evidence-repository';
import type {ReadinessTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import type {AuditJsonValue} from '@/modules/readiness/domain/audit/types';
import {OperatorCommandError} from './operator-command-errors';
import {createSafetyCommandRegistry} from './safety-commands';
import {createProductionCommandRegistry} from './production-commands';
import {createRepairCommandRegistry} from './repair-commands';
import {createCompletionCommandRegistry} from './completion-commands';
import {createNewSpecChecklistCommandRegistry} from './new-spec-checklist-commands';
import {createNewSpecWorkCommandRegistry} from './new-spec-work-commands';
import type {
  OperatorCommandAdapterInput,
  OperatorCommandAdapterResult,
  OperatorCommandDefinition,
  OperatorCommandRegistry,
  OperatorV3CommandName,
} from './operator-command-registry';

const json = (value: unknown): AuditJsonValue => JSON.parse(JSON.stringify(value)) as AuditJsonValue;

function requiredString(payload: Record<string, unknown>, field: string, label: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, `Не заполнено обязательное поле «${label}»`);
  }
  return value.trim();
}

function optionalString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

async function requireAssignment(
  tx: ReadinessTransaction,
  tenantId: string,
  actorId: string,
  assignmentId?: string,
  equipmentId?: string,
) {
  const publicAssignment = assignmentId?.includes(':') ? assignmentId.split(':', 2) : null;
  const crew = await tx.crew.findFirst({
    where: {
      ...(assignmentId && !publicAssignment ? {id: assignmentId} : {}),
      ...(publicAssignment ? {siteId: publicAssignment[0], equipmentId: publicAssignment[1]} : {}),
      ...(equipmentId ? {equipmentId} : {}),
      operatorId: actorId,
      isActive: true,
      equipment: {tenantId, isActive: true},
    },
    select: {id: true, equipmentId: true, siteId: true},
  });
  if (!crew) {
    throw new OperatorCommandError(
      'EQUIPMENT_NOT_ASSIGNED', 403,
      'Эта установка не входит в действующее назначение оператора',
    );
  }
  return crew;
}

async function requireVersionedShift(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
  explicitShiftId?: string | null,
) {
  const id = explicitShiftId ?? input.envelope.aggregateId
    ?? optionalString(input.envelope.payload, 'shiftId');
  if (!id) throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Не указана смена');
  const shift = await tx.shift.findFirst({where: {tenantId: input.context.tenantId, id}});
  if (!shift) throw new OperatorCommandError('NOT_FOUND', 404, 'Смена не найдена');
  await requireAssignment(tx, input.context.tenantId, input.context.actorId, undefined, shift.equipmentId);
  if (shift.version !== input.envelope.expectedVersion) {
    throw new OperatorCommandError(
      'VERSION_CONFLICT', 409,
      'Смена изменилась. Обновите рабочее место и повторите действие',
      {currentVersion: shift.version},
    );
  }
  return shift;
}

async function advanceShiftVersion(
  tx: ReadinessTransaction,
  tenantId: string,
  shiftId: string,
  expectedVersion: number,
  actorId: string,
): Promise<number> {
  const changed = await tx.shift.updateMany({
    where: {tenantId, id: shiftId, version: expectedVersion, state: {notIn: ['CLOSED', 'CANCELLED']}},
    data: {version: {increment: 1}, lastEditedById: actorId},
  });
  if (changed.count !== 1) {
    const current = await tx.shift.findFirst({where: {tenantId, id: shiftId}, select: {version: true, state: true}});
    throw new OperatorCommandError(
      current?.state === 'CLOSED' || current?.state === 'CANCELLED' ? 'INVALID_TRANSITION' : 'VERSION_CONFLICT',
      409,
      current?.state === 'CLOSED' || current?.state === 'CANCELLED'
        ? 'Закрытую смену изменять нельзя'
        : 'Смена изменилась. Обновите рабочее место и повторите действие',
      current ? {currentVersion: current.version} : undefined,
    );
  }
  return expectedVersion + 1;
}

async function recordEffects(
  tx: ReadinessTransaction,
  commandName: OperatorV3CommandName,
  input: OperatorCommandAdapterInput,
  entityType: string,
  entityId: string,
  entityVersion: number,
  result: unknown,
): Promise<void> {
  const occurredAt = new Date(input.envelope.occurredAt);
  await recordChainedReadinessAudit(tx, {
    tenantId: input.context.tenantId,
    action: `operator-v3.${commandName}`,
    entityType,
    entityId,
    entityVersion,
    actor: {
      id: input.context.actorId,
      name: input.context.actorName,
      role: input.context.actorRole,
      actingAs: null,
    },
    requestId: input.context.requestId,
    correlationId: input.context.correlationId,
    idempotencyKey: input.envelope.commandId,
    occurredAt,
    after: json({
      commandId: input.envelope.commandId,
      deviceId: input.envelope.deviceId,
      deviceSequence: input.envelope.deviceSequence,
      checksum: input.checksum,
      result,
    }),
  });
  await tx.outboxEvent.createMany({
    skipDuplicates: true,
    data: [{
      type: 'OperatorV3CommandCompleted',
      tenantId: input.context.tenantId,
      aggregateId: entityId,
      aggregateType: entityType,
      dedupeKey: `operator-v3:${input.context.tenantId}:${input.envelope.commandId}`,
      occurredAt,
      payload: {
        commandName,
        commandId: input.envelope.commandId,
        deviceId: input.envelope.deviceId,
        deviceSequence: input.envelope.deviceSequence,
        checksum: input.checksum,
        entityVersion,
      } as Prisma.InputJsonValue,
    }],
  });
}

async function acceptAssignment(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const assignmentId = requiredString(input.envelope.payload, 'assignmentId', 'Назначение');
  const assignment = await requireAssignment(
    tx, input.context.tenantId, input.context.actorId, assignmentId,
  );
  let shift = await tx.shift.findFirst({
    where: {
      tenantId: input.context.tenantId,
      equipmentId: assignment.equipmentId,
      state: {in: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED', 'HANDOVER_PENDING']},
    },
    orderBy: {updatedAt: 'desc'},
  });
  if (shift) {
    if (shift.version !== input.envelope.expectedVersion) {
      throw new OperatorCommandError('VERSION_CONFLICT', 409, 'Смена изменилась. Обновите рабочее место и повторите действие', {
        currentVersion: shift.version,
      });
    }
  } else {
    if (input.envelope.expectedVersion !== 0) {
      throw new OperatorCommandError('VERSION_CONFLICT', 409, 'Для нового назначения ожидалась начальная версия');
    }
    const repo = new ShiftRepository(tx);
    const timezone = normalizeTenantTimezone(await repo.tenantTimezone(input.context.tenantId));
    const at = new Date(input.envelope.occurredAt);
    shift = await repo.create({
      tenantId: input.context.tenantId,
      equipmentId: assignment.equipmentId,
      type: at.getUTCHours() >= 18 || at.getUTCHours() < 6 ? 'NIGHT' : 'DAY',
      productionDate: tenantProductionDate(at, timezone),
      timezone,
      plannedStartAt: null,
      plannedEndAt: null,
      actorId: input.context.actorId,
    });
  }
  await recordEffects(tx, 'accept-assignment', input, 'Shift', shift.id, shift.version, {
    assignmentId,
    equipmentId: assignment.equipmentId,
  });
  return {newVersion: shift.version, createdEvents: ['Назначение получено']};
}

async function acceptEquipment(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const handoverId = requiredString(input.envelope.payload, 'handoverId', 'Передача установки');
  const handover = await tx.shiftHandover.findFirst({
    where: {tenantId: input.context.tenantId, id: handoverId, state: 'SUBMITTED'},
    include: {shift: true},
  });
  if (!handover) throw new OperatorCommandError('NOT_FOUND', 404, 'Передача установки не найдена');
  if (handover.submittedById === input.context.actorId) {
    throw new OperatorCommandError('FORBIDDEN', 403, 'Нельзя принять передачу, которую вы оформили сами');
  }
  await requireAssignment(tx, input.context.tenantId, input.context.actorId, undefined, handover.shift.equipmentId);
  if (handover.version !== input.envelope.expectedVersion) {
    throw new OperatorCommandError('VERSION_CONFLICT', 409, 'Передача изменилась. Обновите рабочее место');
  }
  const changed = await tx.shiftHandover.updateMany({
    where: {tenantId: input.context.tenantId, id: handover.id, version: handover.version, state: 'SUBMITTED'},
    data: {state: 'ACCEPTED', acceptedById: input.context.actorId, acceptedAt: new Date(input.envelope.occurredAt), version: {increment: 1}},
  });
  if (changed.count !== 1) throw new OperatorCommandError('VERSION_CONFLICT', 409, 'Передача уже изменена');
  if (handover.shift.state === 'HANDOVER_PENDING') {
    await tx.shift.updateMany({
      where: {tenantId: input.context.tenantId, id: handover.shiftId, version: handover.shift.version, state: 'HANDOVER_PENDING'},
      data: {state: 'CLOSED', closedAt: new Date(input.envelope.occurredAt), closedById: input.context.actorId, version: {increment: 1}},
    });
  }
  const version = handover.version + 1;
  await recordEffects(tx, 'accept-equipment', input, 'ShiftHandover', handover.id, version, {shiftId: handover.shiftId});
  return {newVersion: version, createdEvents: ['Установка принята']};
}

async function createInspection(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const shiftId = requiredString(input.envelope.payload, 'shiftId', 'Смена');
  const shift = await requireVersionedShift(tx, input, shiftId);
  const phaseValue = optionalString(input.envelope.payload, 'phase') ?? 'PRE_SHIFT';
  if (phaseValue !== 'PRE_SHIFT' && phaseValue !== 'POST_SHIFT') {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Неизвестный этап проверки');
  }
  const phase = phaseValue as ShiftInspectionPhase;
  const existing = await tx.inspection.findUnique({
    where: {tenantId_shiftId_phase: {tenantId: input.context.tenantId, shiftId, phase}},
  });
  if (existing) {
    return {newVersion: shift.version, createdEvents: ['Проверка уже создана']};
  }
  const equipment = await tx.equipment.findFirst({
    where: {tenantId: input.context.tenantId, id: shift.equipmentId, isActive: true},
    select: {id: true, model: true, hammerKind: true, isCombined: true, engineHoursTotal: true},
  });
  if (!equipment) throw new OperatorCommandError('NOT_FOUND', 404, 'Установка не найдена');
  const types = requiredBlockTypes(equipment);
  const templates = await tx.checklistTemplate.findMany({
    where: {tenantId: input.context.tenantId, level: 'EO', isActive: true, blockType: {in: types}},
    include: {sections: {orderBy: {order: 'asc'}, include: {items: {orderBy: {order: 'asc'}}}}},
  });
  const candidates: CandidateBlock[] = templates.map((template) => ({
    id: template.id,
    blockType: template.blockType,
    name: template.name,
    appliesToModel: template.appliesToModel,
    appliesToHammerKind: template.appliesToHammerKind,
    sections: template.sections.map((section) => ({
      title: section.title,
      order: section.order,
      items: section.items.map((item) => ({
        id: item.id, text: item.text, answerType: item.answerType, unit: item.unit, norm: item.norm,
        provenance: item.provenance, required: item.required, photoRequired: item.photoRequired,
        createsDefect: item.createsDefect, defectSeverity: item.defectSeverity, order: item.order,
      })),
    })),
  }));
  const blocks = selectBlocks(candidates, equipment);
  const base = blocks.find((block) => block.blockType === 'BASE');
  if (!base) {
    throw new OperatorCommandError('REQUIRED_ACTION_INCOMPLETE', 409, 'Для установки не настроен ежесменный список проверки');
  }
  const snapshot = itemsForPhase(composeChecklist(blocks), phase);
  if (snapshot.length === 0) {
    throw new OperatorCommandError('REQUIRED_ACTION_INCOMPLETE', 409, 'В списке проверки нет пунктов для выбранного этапа');
  }
  const occurredAt = new Date(input.envelope.occurredAt);
  const maintenance = await tx.maintenanceRecord.create({
    data: {
      tenantId: input.context.tenantId,
      equipmentId: equipment.id,
      type: 'EO',
      status: 'IN_PROGRESS',
      title: phase === 'POST_SHIFT' ? 'Ежесменный осмотр — после смены' : 'Ежесменный осмотр — до смены',
      createdById: input.context.actorId,
      startedAt: occurredAt,
    },
  });
  const inspection = await tx.inspection.create({
    data: {
      tenantId: input.context.tenantId,
      equipmentId: equipment.id,
      templateId: base.id,
      maintenanceRecordId: maintenance.id,
      shiftId,
      phase,
      level: 'EO',
      performedById: input.context.actorId,
      inspectionDate: occurredAt,
      engineHours: equipment.engineHoursTotal,
      status: 'DRAFT',
      templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  const version = await advanceShiftVersion(tx, input.context.tenantId, shiftId, shift.version, input.context.actorId);
  await recordEffects(tx, 'create-inspection', input, 'Inspection', inspection.id, version, {shiftId, phase});
  return {newVersion: version, createdEvents: ['Проверка начата']};
}

type InspectionAnswerPayload = {itemId: string; result: string; value?: string | null; note?: string | null; photoCount?: number};

function inspectionAnswers(payload: Record<string, unknown>): InspectionAnswerPayload[] {
  if (!Array.isArray(payload.answers)) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Не переданы ответы проверки');
  }
  return payload.answers.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Некорректный ответ проверки');
    }
    const value = raw as Record<string, unknown>;
    return {
      itemId: requiredString(value, 'itemId', 'Пункт проверки'),
      result: requiredString(value, 'result', 'Результат проверки'),
      value: typeof value.value === 'string' ? value.value : null,
      note: typeof value.note === 'string' ? value.note : null,
      photoCount: typeof value.photoCount === 'number' && Number.isInteger(value.photoCount) && value.photoCount >= 0
        ? value.photoCount : 0,
    };
  });
}

async function saveInspection(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const inspectionId = requiredString(input.envelope.payload, 'inspectionId', 'Проверка');
  const inspection = await tx.inspection.findFirst({
    where: {tenantId: input.context.tenantId, id: inspectionId, performedById: input.context.actorId},
  });
  if (!inspection) throw new OperatorCommandError('NOT_FOUND', 404, 'Проверка не найдена');
  if (inspection.status === 'COMPLETED') throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Завершённую проверку изменять нельзя');
  if (!inspection.shiftId) throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Проверка не связана со сменой');
  const shift = await requireVersionedShift(tx, input, inspection.shiftId);
  const answers = inspectionAnswers(input.envelope.payload);
  await tx.inspectionAnswer.deleteMany({where: {tenantId: input.context.tenantId, inspectionId}});
  if (answers.length > 0) {
    await tx.inspectionAnswer.createMany({
      data: answers.map((answer) => ({tenantId: input.context.tenantId, inspectionId, ...answer})),
    });
  }
  const version = await advanceShiftVersion(tx, input.context.tenantId, shift.id, shift.version, input.context.actorId);
  await recordEffects(tx, 'save-inspection', input, 'Inspection', inspectionId, version, {answerCount: answers.length});
  return {newVersion: version, createdEvents: ['Ответы проверки сохранены']};
}

async function completeInspectionAdapter(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const inspectionId = requiredString(input.envelope.payload, 'inspectionId', 'Проверка');
  const inspection = await tx.inspection.findFirst({
    where: {tenantId: input.context.tenantId, id: inspectionId, performedById: input.context.actorId},
    include: {answers: true},
  });
  if (!inspection) throw new OperatorCommandError('NOT_FOUND', 404, 'Проверка не найдена');
  if (inspection.status === 'COMPLETED') throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Проверка уже завершена');
  if (!inspection.shiftId) throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Проверка не связана со сменой');
  const shift = await requireVersionedShift(tx, input, inspection.shiftId);
  const items = (inspection.templateSnapshot as unknown as SnapItem[]) ?? [];
  const answers: AnswerLike[] = inspection.answers.map((answer) => ({
    itemId: answer.itemId,
    result: answer.result,
    photoCount: answer.photoCount,
  }));
  const missing = findMissing(items, answers);
  if (missing.missingAnswers.length > 0) {
    throw new OperatorCommandError(
      'REQUIRED_ACTION_INCOMPLETE', 409,
      `Проверка не заполнена: пунктов без ответа ${missing.missingAnswers.length}`,
    );
  }
  const at = new Date(input.envelope.occurredAt);
  await tx.inspection.update({
    where: {id: inspection.id},
    data: {
      status: 'COMPLETED',
      healthScore: computeHealthScore(items, answers),
      signedByName: input.context.actorName,
      signedAt: at,
    },
  });
  if (inspection.maintenanceRecordId) {
    await tx.maintenanceRecord.updateMany({
      where: {tenantId: input.context.tenantId, id: inspection.maintenanceRecordId, status: {not: 'DONE'}},
      data: {status: 'DONE', completedAt: at, engineHoursAtService: inspection.engineHours ?? undefined},
    });
  }
  const version = await advanceShiftVersion(tx, input.context.tenantId, shift.id, shift.version, input.context.actorId);
  await recordEffects(tx, 'complete-inspection', input, 'Inspection', inspection.id, version, {shiftId: shift.id});
  return {newVersion: version, createdEvents: ['Проверка завершена']};
}

async function recordMeter(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const shiftId = requiredString(input.envelope.payload, 'shiftId', 'Смена');
  const shift = await requireVersionedShift(tx, input, shiftId);
  const raw = input.envelope.payload.engineHours;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Показание моточасов должно быть целым неотрицательным числом');
  }
  const recorded = await recordMeterReadingInTx(tx as never, shift.equipmentId, {
    engineHours: raw,
    recordedAt: input.envelope.occurredAt,
    source: 'MANUAL',
    note: optionalString(input.envelope.payload, 'note') ?? 'Снято оператором перед началом смены',
  }, {tenantId: input.context.tenantId, recordedById: input.context.actorId, allowDecrease: false});
  const version = await advanceShiftVersion(tx, input.context.tenantId, shift.id, shift.version, input.context.actorId);
  await recordEffects(tx, 'record-meter', input, 'MeterReading', recorded.reading.id, version, {
    shiftId,
    warning: recorded.warning,
  });
  return {
    newVersion: version,
    createdEvents: recorded.warning ? ['Моточасы сохранены с предупреждением'] : ['Моточасы сохранены'],
  };
}

async function versionedAcknowledgement(
  tx: ReadinessTransaction,
  commandName: 'confirm-work-zone' | 'complete-preparation',
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const shiftId = requiredString(input.envelope.payload, 'shiftId', 'Смена');
  const shift = await requireVersionedShift(tx, input, shiftId);
  const version = await advanceShiftVersion(tx, input.context.tenantId, shift.id, shift.version, input.context.actorId);
  const event = commandName === 'confirm-work-zone' ? 'Рабочая зона подтверждена' : 'Подготовка завершена';
  await recordEffects(tx, commandName, input, 'Shift', shift.id, version, input.envelope.payload);
  return {newVersion: version, createdEvents: [event]};
}

async function startShift(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const shiftId = requiredString(input.envelope.payload, 'shiftId', 'Смена');
  await requireVersionedShift(tx, input, shiftId);
  const result = await startShiftCommand({
    tx,
    context: {
      tenantId: input.context.tenantId,
      actorId: input.context.actorId,
      actorName: input.context.actorName,
      actorRole: input.context.actorRole,
      actingAs: null,
      requestId: input.context.requestId,
      correlationId: input.context.correlationId,
    },
    id: shiftId,
    key: `v3-${input.checksum}`,
    ifMatch: formatStrongEtag('shift', shiftId, input.envelope.expectedVersion),
    expectedVersion: input.envelope.expectedVersion,
    now: new Date(input.envelope.occurredAt),
  });
  if (result.status >= 400) {
    const body = result.body as unknown as {error?: {message?: string}};
    throw new OperatorCommandError('READINESS_DENIED', 423, body.error?.message ?? 'Работу начинать нельзя');
  }
  const body = result.body as unknown as {data?: {version?: number}};
  return {newVersion: body.data?.version ?? input.envelope.expectedVersion + 1, createdEvents: ['Смена начата']};
}

export function createExistingOperatorCommandRegistry(tx: ReadinessTransaction): OperatorCommandRegistry {
  const definitions: Array<[OperatorV3CommandName, OperatorCommandDefinition]> = [
    ['accept-assignment', {critical: false, execute: (input) => acceptAssignment(tx, input)}],
    ['accept-equipment', {critical: true, execute: (input) => acceptEquipment(tx, input)}],
    ['create-inspection', {critical: false, execute: (input) => createInspection(tx, input)}],
    ['save-inspection', {critical: false, execute: (input) => saveInspection(tx, input)}],
    ['complete-inspection', {critical: true, execute: (input) => completeInspectionAdapter(tx, input)}],
    ['confirm-work-zone', {critical: false, execute: (input) => versionedAcknowledgement(tx, 'confirm-work-zone', input)}],
    ['record-meter', {critical: false, execute: (input) => recordMeter(tx, input)}],
    ['complete-preparation', {critical: true, execute: (input) => versionedAcknowledgement(tx, 'complete-preparation', input)}],
    ['start-shift', {critical: true, execute: (input) => startShift(tx, input)}],
  ];
  return new Map([
    ...definitions,
    ...createSafetyCommandRegistry(tx),
    ...createProductionCommandRegistry(tx),
    ...createRepairCommandRegistry(tx),
    ...createCompletionCommandRegistry(tx),
    ...createNewSpecChecklistCommandRegistry(new OperatorChecklistRepository(tx)),
    ...createNewSpecWorkCommandRegistry(new OperatorShiftEvidenceRepository(tx)),
  ]);
}
