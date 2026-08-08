import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/postgres-client/client';
import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {DefectRecord, DefectSeverity, DefectStatus} from '../../domain/defects/types';
import type {ReadinessTransaction} from '../tenant-transaction';

export type DefectRow = Awaited<ReturnType<DefectRepository['get']>>;

export const toDefectRecord = (row: {
  id: string; tenantId: string; equipmentId: string; severity: string; status: string;
  title: string; node: string | null; maintenanceRecordId: string | null; version: number;
}): DefectRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  equipmentId: row.equipmentId,
  severity: row.severity as DefectSeverity,
  status: row.status as DefectStatus,
  title: row.title,
  node: row.node,
  maintenanceRecordId: row.maintenanceRecordId,
  version: row.version,
});

export class DefectRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async requireEquipment(tenantId: string, equipmentId: string): Promise<void> {
    const equipment = await this.tx.equipment.findFirst({
      where: {tenantId, id: equipmentId, isActive: true}, select: {id: true},
    });
    if (!equipment) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Resource not found');
  }

  async requireActor(tenantId: string, actorId: string): Promise<void> {
    const actor = await this.tx.user.findFirst({
      where: {tenantId, id: actorId, isActive: true}, select: {id: true},
    });
    if (!actor) throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Active actor not found');
  }

  /** Наряд должен принадлежать тому же тенанту и той же установке. */
  async requireMaintenanceRecord(input: {
    tenantId: string; id: string; equipmentId: string;
  }): Promise<void> {
    const record = await this.tx.maintenanceRecord.findFirst({
      where: {tenantId: input.tenantId, id: input.id, equipmentId: input.equipmentId},
      select: {id: true},
    });
    if (!record) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Resource not found');
  }

  async create(input: {
    tenantId: string; equipmentId: string; severity: DefectSeverity; title: string;
    description: string; node: string | null; inspectionId: string | null;
    shiftId: string | null; actorId: string;
  }) {
    return this.tx.equipmentDefect.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        severity: input.severity,
        title: input.title,
        description: input.description,
        node: input.node,
        inspectionId: input.inspectionId,
        shiftId: input.shiftId,
        reportedById: input.actorId,
      },
    });
  }

  async get(tenantId: string, id: string) {
    const defect = await this.tx.equipmentDefect.findFirst({where: {tenantId, id}});
    if (!defect) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Resource not found');
    return defect;
  }

  async list(input: {
    tenantId: string; equipmentId?: string; status?: DefectStatus; severity?: DefectSeverity;
    openStatuses?: readonly DefectStatus[]; limit: number;
    cursor?: {reportedAt: Date; id: string};
  }) {
    const where: Prisma.EquipmentDefectWhereInput = {
      tenantId: input.tenantId,
      ...(input.equipmentId ? {equipmentId: input.equipmentId} : {}),
      ...(input.status ? {status: input.status} : {}),
      ...(input.severity ? {severity: input.severity} : {}),
      ...(input.openStatuses ? {status: {in: [...input.openStatuses]}} : {}),
      ...(input.cursor ? {OR: [
        {reportedAt: {lt: input.cursor.reportedAt}},
        {reportedAt: input.cursor.reportedAt, id: {lt: input.cursor.id}},
      ]} : {}),
    };
    const [rows, total] = await Promise.all([
      this.tx.equipmentDefect.findMany({
        where, orderBy: [{reportedAt: 'desc'}, {id: 'desc'}], take: input.limit + 1,
      }),
      this.tx.equipmentDefect.count({where: {...where, OR: undefined}}),
    ]);
    return {rows, total};
  }

  /**
   * Обновление с проверкой версии внутри самого запроса: если параллельная
   * команда уже сдвинула версию, обновится ноль строк и мы это увидим,
   * а не затрём чужое решение.
   */
  private async updateGuarded(input: {
    tenantId: string; id: string; expectedVersion: number;
    data: Prisma.EquipmentDefectUpdateManyMutationInput;
  }) {
    const updated = await this.tx.equipmentDefect.updateMany({
      where: {tenantId: input.tenantId, id: input.id, version: input.expectedVersion},
      data: {...input.data, version: {increment: 1}},
    });
    if (updated.count !== 1) {
      throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Defect version conflict');
    }
    return this.get(input.tenantId, input.id);
  }

  async triage(input: {
    tenantId: string; id: string; expectedVersion: number; actorId: string;
    status: DefectStatus; severity?: DefectSeverity; maintenanceRecordId?: string | null;
  }) {
    return this.updateGuarded({
      tenantId: input.tenantId, id: input.id, expectedVersion: input.expectedVersion,
      data: {
        status: input.status,
        ...(input.severity ? {severity: input.severity} : {}),
        ...(input.maintenanceRecordId !== undefined
          ? {maintenanceRecordId: input.maintenanceRecordId} : {}),
        triagedById: input.actorId,
        triagedAt: new Date(),
      },
    });
  }

  async close(input: {
    tenantId: string; id: string; expectedVersion: number; actorId: string;
    status: Extract<DefectStatus, 'CLOSED' | 'REJECTED'>; resolution: string;
  }) {
    return this.updateGuarded({
      tenantId: input.tenantId, id: input.id, expectedVersion: input.expectedVersion,
      data: {
        status: input.status,
        resolution: input.resolution,
        resolvedById: input.actorId,
        resolvedAt: new Date(),
      },
    });
  }
}
