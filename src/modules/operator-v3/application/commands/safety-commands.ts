import type {Prisma} from '@/generated/postgres-client/client';
import type {AuditJsonValue} from '@/modules/readiness/domain/audit/types';
import {recordChainedReadinessAudit} from '@/modules/readiness/infrastructure/audit/record-audit';
import type {ReadinessTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {
  classifyObservedHazard,
  OBSERVED_HAZARD_SIGNS,
  type ObservedHazardSign,
} from '../../domain/safety-incident';
import {SafetyIncidentRepository} from '../../infrastructure/safety-incident-repository';
import {OperatorCommandError} from './operator-command-errors';
import type {
  OperatorCommandAdapterInput,
  OperatorCommandAdapterResult,
  OperatorCommandDefinition,
  OperatorCommandRegistry,
  OperatorV3CommandName,
} from './operator-command-registry';

const INCIDENT_CATEGORIES = [
  'TECHNICAL_HAZARD', 'PEOPLE', 'WORKSITE', 'ORGANIZATION', 'EQUIPMENT_DEFECT', 'OTHER',
] as const;

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

function booleanValue(payload: Record<string, unknown>, field: string, defaultValue = false): boolean {
  const value = payload[field];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, `Поле «${field}» должно содержать «да» или «нет»`);
  }
  return value;
}

function stringArray(payload: Record<string, unknown>, field: string, label: string): string[] {
  const value = payload[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, `Некорректно заполнено поле «${label}»`);
  }
  return [...new Set(value.map((item) => String(item).trim()))];
}

function observedSigns(payload: Record<string, unknown>): ObservedHazardSign[] {
  const values = stringArray(payload, 'observedSigns', 'Наблюдаемые признаки');
  if (values.length === 0) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Укажите хотя бы один наблюдаемый признак');
  }
  if (values.some((value) => !(OBSERVED_HAZARD_SIGNS as readonly string[]).includes(value))) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Передан неизвестный наблюдаемый признак');
  }
  return values as ObservedHazardSign[];
}

async function recordSafetyEffects(
  tx: ReadinessTransaction,
  commandName: Extract<OperatorV3CommandName, 'report-defect' | 'report-incident' | 'confirm-safe-stop'>,
  input: OperatorCommandAdapterInput,
  entity: {type: 'EquipmentDefect' | 'SafetyIncident'; id: string; version: number},
  eventType: string,
  result: Record<string, unknown>,
): Promise<void> {
  const occurredAt = new Date(input.envelope.occurredAt);
  await recordChainedReadinessAudit(tx, {
    tenantId: input.context.tenantId,
    action: `operator-v3.${commandName}`,
    entityType: entity.type,
    entityId: entity.id,
    entityVersion: entity.version,
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
      ...result,
    }),
  });
  await tx.outboxEvent.createMany({
    skipDuplicates: true,
    data: [{
      type: eventType,
      tenantId: input.context.tenantId,
      aggregateId: entity.id,
      aggregateType: entity.type,
      dedupeKey: `operator-v3:${input.context.tenantId}:${input.envelope.commandId}`,
      occurredAt,
      payload: {
        commandName,
        commandId: input.envelope.commandId,
        deviceId: input.envelope.deviceId,
        deviceSequence: input.envelope.deviceSequence,
        checksum: input.checksum,
        entityVersion: entity.version,
        ...result,
      } as Prisma.InputJsonValue,
    }],
  });
}

async function reportIncident(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const repository = new SafetyIncidentRepository(tx);
  const existing = await repository.findByClientCommand(input.context.tenantId, input.envelope.commandId);
  if (existing) {
    return {
      newVersion: input.envelope.expectedVersion + (existing.shiftId ? 1 : 0),
      createdEvents: existing.stopRequired
        ? ['Опасное событие зарегистрировано', 'Требуется безопасная остановка']
        : ['Опасное событие зарегистрировано'],
    };
  }
  const payload = input.envelope.payload;
  const category = requiredString(payload, 'category', 'Категория');
  if (!(INCIDENT_CATEGORIES as readonly string[]).includes(category)) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Неизвестная категория опасного события');
  }
  const description = requiredString(payload, 'description', 'Что произошло');
  if (description.length < 3 || description.length > 4000) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Описание события должно содержать от 3 до 4000 знаков');
  }
  const signs = observedSigns(payload);
  const injured = booleanValue(payload, 'injured');
  const classification = classifyObservedHazard({observedSigns: signs, injured});
  const shiftId = optionalString(payload, 'shiftId') ?? input.envelope.aggregateId ?? null;
  const equipmentId = optionalString(payload, 'equipmentId');
  const scope = await repository.resolveOperatorScope({
    tenantId: input.context.tenantId,
    actorId: input.context.actorId,
    shiftId,
    equipmentId,
  });
  const evidenceMediaIds = await repository.requireConfirmedImages({
    tenantId: input.context.tenantId,
    actorId: input.context.actorId,
    entityType: 'safety_incident',
    commandId: input.envelope.commandId,
    mediaIds: stringArray(payload, 'evidenceMediaIds', 'Фотографии'),
    required: true,
  });
  const incident = await repository.createIncident({
    tenantId: input.context.tenantId,
    shiftId: scope.shift?.id ?? null,
    equipmentId: scope.equipmentId,
    siteId: scope.siteId,
    category,
    state: classification.stopRequired ? 'STOP_REQUIRED' : 'REPORTED',
    severity: classification.severity,
    description,
    observedSigns: signs,
    stopRequired: classification.stopRequired,
    emergencyStopApplied: booleanValue(payload, 'emergencyStopApplied'),
    injured,
    safeStateDescription: optionalString(payload, 'safeStateDescription'),
    evidenceMediaIds,
    classificationRuleId: classification.ruleId,
    classificationRuleVersion: classification.ruleVersion,
    occurredAt: new Date(input.envelope.occurredAt),
    reportedById: input.context.actorId,
    deviceId: input.envelope.deviceId,
    clientCommandId: input.envelope.commandId,
  });
  const newVersion = await repository.advanceShiftVersion({
    tenantId: input.context.tenantId,
    shiftId: scope.shift?.id ?? null,
    currentVersion: scope.shift?.version ?? null,
    actorId: input.context.actorId,
  });
  await recordSafetyEffects(tx, 'report-incident', input, {
    type: 'SafetyIncident', id: incident.id, version: incident.version,
  }, 'OperatorV3SafetyIncidentReported', {
    shiftId: scope.shift?.id ?? null,
    severity: classification.severity,
    stopRequired: classification.stopRequired,
    observedSigns: signs,
    evidenceCount: evidenceMediaIds.length,
  });
  return {
    newVersion,
    createdEvents: classification.stopRequired
      ? ['Опасное событие зарегистрировано', 'Требуется безопасная остановка']
      : ['Опасное событие зарегистрировано'],
  };
}

async function reportDefect(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const payload = input.envelope.payload;
  const repository = new SafetyIncidentRepository(tx);
  const shiftId = optionalString(payload, 'shiftId') ?? input.envelope.aggregateId ?? null;
  const scope = await repository.resolveOperatorScope({
    tenantId: input.context.tenantId,
    actorId: input.context.actorId,
    shiftId,
    equipmentId: optionalString(payload, 'equipmentId'),
  });
  const sourceKey = `operator-v3:${input.envelope.commandId}`;
  const existing = await tx.equipmentDefect.findFirst({
    where: {tenantId: input.context.tenantId, sourceKey},
  });
  if (existing) {
    return {newVersion: input.envelope.expectedVersion + (scope.shift ? 1 : 0), createdEvents: ['Дефект зарегистрирован']};
  }
  const description = requiredString(payload, 'description', 'Описание наблюдаемого состояния');
  const signs = observedSigns(payload);
  const classification = classifyObservedHazard({observedSigns: signs, injured: false});
  const evidenceMediaIds = await repository.requireConfirmedImages({
    tenantId: input.context.tenantId,
    actorId: input.context.actorId,
    entityType: 'equipment_defect',
    commandId: input.envelope.commandId,
    mediaIds: stringArray(payload, 'evidenceMediaIds', 'Фотографии'),
    required: classification.stopRequired,
  });
  const defect = await tx.equipmentDefect.create({
    data: {
      tenantId: input.context.tenantId,
      equipmentId: scope.equipmentId!,
      severity: classification.severity,
      title: classification.stopRequired ? 'Критический дефект по наблюдаемым признакам' : 'Дефект по наблюдаемым признакам',
      description,
      node: optionalString(payload, 'node'),
      shiftId: scope.shift?.id ?? null,
      reportedById: input.context.actorId,
      sourceKey,
      observedSigns: signs as unknown as Prisma.InputJsonValue,
      safeStopApplied: booleanValue(payload, 'safeStopApplied'),
      classificationRuleId: classification.ruleId,
      classificationRuleVersion: classification.ruleVersion,
      evidenceMediaIds: evidenceMediaIds as unknown as Prisma.InputJsonValue,
    },
  });
  let safetyIncidentId: string | null = null;
  if (classification.stopRequired) {
    const incident = await repository.createIncident({
      tenantId: input.context.tenantId,
      shiftId: scope.shift?.id ?? null,
      equipmentId: scope.equipmentId,
      siteId: scope.siteId,
      relatedDefectId: defect.id,
      category: 'EQUIPMENT_DEFECT',
      state: 'STOP_REQUIRED',
      severity: 'CRITICAL',
      description,
      observedSigns: signs,
      stopRequired: true,
      emergencyStopApplied: booleanValue(payload, 'safeStopApplied'),
      injured: false,
      safeStateDescription: null,
      evidenceMediaIds,
      classificationRuleId: classification.ruleId,
      classificationRuleVersion: classification.ruleVersion,
      occurredAt: new Date(input.envelope.occurredAt),
      reportedById: input.context.actorId,
      deviceId: input.envelope.deviceId,
      clientCommandId: `${input.envelope.commandId}:safe-stop`,
    });
    safetyIncidentId = incident.id;
  }
  const newVersion = await repository.advanceShiftVersion({
    tenantId: input.context.tenantId,
    shiftId: scope.shift?.id ?? null,
    currentVersion: scope.shift?.version ?? null,
    actorId: input.context.actorId,
  });
  await recordSafetyEffects(tx, 'report-defect', input, {
    type: 'EquipmentDefect', id: defect.id, version: defect.version,
  }, 'OperatorV3DefectReported', {
    shiftId: scope.shift?.id ?? null,
    severity: classification.severity,
    stopRequired: classification.stopRequired,
    safetyIncidentId,
    observedSigns: signs,
    evidenceCount: evidenceMediaIds.length,
  });
  return {
    newVersion,
    createdEvents: classification.stopRequired
      ? ['Дефект зарегистрирован', 'Требуется безопасная остановка']
      : ['Дефект зарегистрирован'],
  };
}

async function confirmSafeStop(
  tx: ReadinessTransaction,
  input: OperatorCommandAdapterInput,
): Promise<OperatorCommandAdapterResult> {
  const repository = new SafetyIncidentRepository(tx);
  const incidentId = requiredString(input.envelope.payload, 'incidentId', 'Опасное событие');
  const safeStateDescription = requiredString(
    input.envelope.payload,
    'safeStateDescription',
    'Текущее безопасное состояние',
  );
  const incident = await repository.requireStopIncident({
    tenantId: input.context.tenantId,
    id: incidentId,
    actorId: input.context.actorId,
  });
  if (incident.state === 'STOPPED') {
    return {
      newVersion: input.envelope.expectedVersion,
      createdEvents: ['Безопасная остановка уже подтверждена'],
    };
  }
  let shiftVersion: number | null = null;
  if (incident.shiftId) {
    const shift = await tx.shift.findFirst({
      where: {tenantId: input.context.tenantId, id: incident.shiftId},
      select: {version: true},
    });
    if (!shift) throw new OperatorCommandError('NOT_FOUND', 404, 'Смена опасного события не найдена');
    if (shift.version !== input.envelope.expectedVersion) {
      throw new OperatorCommandError(
        'VERSION_CONFLICT', 409,
        'Смена изменилась. Обновите рабочее место и повторите действие',
        {currentVersion: shift.version},
      );
    }
    shiftVersion = shift.version;
  } else if (incident.version !== input.envelope.expectedVersion) {
    throw new OperatorCommandError(
      'VERSION_CONFLICT', 409,
      'Опасное событие изменилось. Обновите рабочее место',
      {currentVersion: incident.version},
    );
  }
  const incidentVersion = await repository.confirmStop({
    tenantId: input.context.tenantId,
    id: incident.id,
    version: incident.version,
    actorId: input.context.actorId,
    stoppedAt: new Date(input.envelope.occurredAt),
    safeStateDescription,
  });
  const newVersion = await repository.advanceShiftVersion({
    tenantId: input.context.tenantId,
    shiftId: incident.shiftId,
    currentVersion: shiftVersion,
    actorId: input.context.actorId,
  });
  await recordSafetyEffects(tx, 'confirm-safe-stop', input, {
    type: 'SafetyIncident', id: incident.id, version: incidentVersion,
  }, 'OperatorV3SafeStopConfirmed', {
    shiftId: incident.shiftId,
    stopped: true,
  });
  return {newVersion, createdEvents: ['Безопасная остановка подтверждена']};
}

export function createSafetyCommandRegistry(tx: ReadinessTransaction): OperatorCommandRegistry {
  const definitions: Array<[OperatorV3CommandName, OperatorCommandDefinition]> = [
    ['report-defect', {critical: false, execute: (input) => reportDefect(tx, input)}],
    ['report-incident', {critical: false, execute: (input) => reportIncident(tx, input)}],
    ['confirm-safe-stop', {critical: true, execute: (input) => confirmSafeStop(tx, input)}],
  ];
  return new Map(definitions);
}
