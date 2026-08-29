import type {Prisma} from '@/generated/postgres-client/client';
import type {ReadinessTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {OperatorCommandError} from '../application/commands/operator-command-errors';
import type {
  HazardSeverity,
  ObservedHazardSign,
  SafetyIncidentState,
} from '../domain/safety-incident';

export interface OperatorSafetyScope {
  shift: {id: string; equipmentId: string; version: number; state: string} | null;
  equipmentId: string | null;
  siteId: string | null;
}

const jsonArray = (values: readonly string[]): Prisma.InputJsonValue => [...values];

export class SafetyIncidentRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async resolveOperatorScope(input: {
    tenantId: string;
    actorId: string;
    shiftId: string | null;
    equipmentId: string | null;
  }): Promise<OperatorSafetyScope> {
    const shift = input.shiftId
      ? await this.tx.shift.findFirst({
          where: {tenantId: input.tenantId, id: input.shiftId, state: {notIn: ['CLOSED', 'CANCELLED']}},
          select: {id: true, equipmentId: true, version: true, state: true},
        })
      : null;
    if (input.shiftId && !shift) {
      throw new OperatorCommandError('NOT_FOUND', 404, 'Действующая смена не найдена');
    }
    const equipmentId = shift?.equipmentId ?? input.equipmentId;
    if (!equipmentId) {
      throw new OperatorCommandError(
        'EQUIPMENT_NOT_ASSIGNED', 403,
        'Не определена установка, к которой относится событие',
      );
    }
    const crew = await this.tx.crew.findFirst({
      where: {
        operatorId: input.actorId,
        equipmentId,
        isActive: true,
        equipment: {tenantId: input.tenantId, isActive: true},
      },
      select: {siteId: true},
    });
    if (!crew) {
      throw new OperatorCommandError(
        'EQUIPMENT_NOT_ASSIGNED', 403,
        'Эта установка не входит в действующее назначение оператора',
      );
    }
    return {shift, equipmentId, siteId: crew.siteId};
  }

  async requireConfirmedImages(input: {
    tenantId: string;
    actorId: string;
    entityType: 'safety_incident' | 'equipment_defect';
    commandId: string;
    mediaIds: readonly string[];
    required: boolean;
  }): Promise<string[]> {
    const ids = [...new Set(input.mediaIds)];
    if (input.required && ids.length === 0) {
      throw new OperatorCommandError(
        'REQUIRED_ACTION_INCOMPLETE', 409,
        'Для этого события обязательна подтверждённая фотография',
      );
    }
    if (ids.length === 0) return [];
    const media = await this.tx.media.findMany({
      where: {
        id: {in: ids},
        tenantId: input.tenantId,
        userId: input.actorId,
        entityType: input.entityType,
        entityId: input.commandId,
        uploadStatus: 'completed',
        isDeleted: false,
      },
      select: {id: true, contentType: true},
    });
    const confirmed = media.filter((item) => item.contentType.startsWith('image/')).map((item) => item.id);
    if (confirmed.length !== ids.length) {
      throw new OperatorCommandError(
        'REQUIRED_ACTION_INCOMPLETE', 409,
        'Фотография не загружена, не подтверждена сервером или недоступна оператору',
      );
    }
    return ids;
  }

  findByClientCommand(tenantId: string, clientCommandId: string) {
    return this.tx.safetyIncident.findUnique({
      where: {tenantId_clientCommandId: {tenantId, clientCommandId}},
    });
  }

  createIncident(input: {
    tenantId: string;
    shiftId: string | null;
    equipmentId: string | null;
    siteId: string | null;
    relatedDefectId?: string | null;
    category: string;
    state: SafetyIncidentState;
    severity: HazardSeverity;
    description: string;
    observedSigns: readonly ObservedHazardSign[];
    stopRequired: boolean;
    emergencyStopApplied: boolean;
    injured: boolean;
    safeStateDescription: string | null;
    evidenceMediaIds: readonly string[];
    classificationRuleId: string;
    classificationRuleVersion: string;
    occurredAt: Date;
    reportedById: string;
    deviceId: string;
    clientCommandId: string;
  }) {
    return this.tx.safetyIncident.create({
      data: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: input.equipmentId,
        siteId: input.siteId,
        relatedDefectId: input.relatedDefectId ?? null,
        category: input.category,
        state: input.state,
        severity: input.severity,
        description: input.description,
        observedSigns: jsonArray(input.observedSigns),
        stopRequired: input.stopRequired,
        emergencyStopApplied: input.emergencyStopApplied,
        injured: input.injured,
        safeStateDescription: input.safeStateDescription,
        evidenceMediaIds: jsonArray(input.evidenceMediaIds),
        classificationRuleId: input.classificationRuleId,
        classificationRuleVersion: input.classificationRuleVersion,
        occurredAt: input.occurredAt,
        reportedById: input.reportedById,
        deviceId: input.deviceId,
        clientCommandId: input.clientCommandId,
      },
    });
  }

  async requireStopIncident(input: {tenantId: string; id: string; actorId: string}) {
    const incident = await this.tx.safetyIncident.findFirst({
      where: {tenantId: input.tenantId, id: input.id},
    });
    if (!incident) throw new OperatorCommandError('NOT_FOUND', 404, 'Опасное событие не найдено');
    if (!incident.stopRequired) {
      throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Для события не требуется безопасная остановка');
    }
    if (incident.state === 'STOPPED') return incident;
    if (incident.state !== 'STOP_REQUIRED') {
      throw new OperatorCommandError('INVALID_TRANSITION', 409, 'Событие не ожидает подтверждения остановки');
    }
    await this.resolveOperatorScope({
      tenantId: input.tenantId,
      actorId: input.actorId,
      shiftId: incident.shiftId,
      equipmentId: incident.equipmentId,
    });
    return incident;
  }

  async confirmStop(input: {
    tenantId: string;
    id: string;
    version: number;
    actorId: string;
    stoppedAt: Date;
    safeStateDescription: string;
  }) {
    const changed = await this.tx.safetyIncident.updateMany({
      where: {
        tenantId: input.tenantId,
        id: input.id,
        version: input.version,
        state: 'STOP_REQUIRED',
      },
      data: {
        state: 'STOPPED',
        stoppedAt: input.stoppedAt,
        stoppedById: input.actorId,
        safeStateDescription: input.safeStateDescription,
        version: {increment: 1},
      },
    });
    if (changed.count !== 1) {
      throw new OperatorCommandError(
        'VERSION_CONFLICT', 409,
        'Состояние опасного события изменилось. Обновите рабочее место',
      );
    }
    return input.version + 1;
  }

  async advanceShiftVersion(input: {
    tenantId: string;
    shiftId: string | null;
    currentVersion: number | null;
    actorId: string;
  }): Promise<number> {
    if (!input.shiftId || input.currentVersion === null) return 1;
    const changed = await this.tx.shift.updateMany({
      where: {
        tenantId: input.tenantId,
        id: input.shiftId,
        version: input.currentVersion,
        state: {notIn: ['CLOSED', 'CANCELLED']},
      },
      data: {version: {increment: 1}, lastEditedById: input.actorId},
    });
    if (changed.count !== 1) {
      throw new OperatorCommandError(
        'VERSION_CONFLICT', 409,
        'Смена изменилась. Обновите рабочее место и повторите действие',
      );
    }
    return input.currentVersion + 1;
  }
}
