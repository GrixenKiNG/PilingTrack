import {randomUUID} from 'node:crypto';
import type {Prisma, ShiftState, ShiftType} from '@/generated/postgres-client/client';
import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {ReadinessTransaction} from '../tenant-transaction';

const includeHandovers = {handovers: {orderBy: {createdAt: 'desc' as const}}};
export type ShiftRow = Prisma.ShiftGetPayload<{include: typeof includeHandovers}>;

const conflict = (message: string, current?: unknown) =>
  new ReadinessCommandError('VERSION_CONFLICT', 409, message, current ? {current} : undefined);

export class ShiftRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async requireActor(tenantId: string, actorId: string): Promise<void> {
    if (!await this.tx.user.findFirst({where: {tenantId, id: actorId, isActive: true}, select: {id: true}})) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Учётная запись неактивна или не найдена');
    }
  }

  async requireEquipment(tenantId: string, equipmentId: string): Promise<void> {
    if (!await this.tx.equipment.findFirst({where: {tenantId, id: equipmentId, isActive: true}, select: {id: true}})) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Запись не найдена');
    }
  }

  async tenantTimezone(tenantId: string): Promise<string | null> {
    return (await this.tx.tenantSettings.findUnique({where: {tenantId}, select: {timezone: true}}))?.timezone ?? null;
  }

  create(input: {tenantId: string; equipmentId: string; type: ShiftType; productionDate: Date; timezone: string;
    plannedStartAt: Date | null; plannedEndAt: Date | null; actorId: string}) {
    const {actorId, ...shift} = input;
    return this.tx.shift.create({data: {id: randomUUID(), ...shift, createdById: actorId,
      lastEditedById: actorId}, include: includeHandovers});
  }

  async get(tenantId: string, id: string): Promise<ShiftRow> {
    const row = await this.tx.shift.findFirst({where: {tenantId, id}, include: includeHandovers});
    if (!row) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Запись не найдена');
    return row;
  }

  async list(input: {tenantId: string; equipmentId?: string; state?: ShiftState; type?: ShiftType;
    from?: Date; to?: Date; limit: number}) {
    const where = {tenantId: input.tenantId, ...(input.equipmentId ? {equipmentId: input.equipmentId} : {}),
      ...(input.state ? {state: input.state} : {}), ...(input.type ? {type: input.type} : {}),
      ...(input.from || input.to ? {productionDate: {
        ...(input.from ? {gte: input.from} : {}),
        ...(input.to ? {lte: input.to} : {}),
      }} : {})};
    const [rows, total] = await Promise.all([
      this.tx.shift.findMany({where, include: includeHandovers, orderBy: [{productionDate: 'desc'}, {createdAt: 'desc'}], take: input.limit}),
      this.tx.shift.count({where}),
    ]);
    return {rows, total};
  }

  async updatePlanned(input: {tenantId: string; id: string; expectedVersion: number; actorId: string;
    type?: ShiftType; plannedStartAt?: Date | null; plannedEndAt?: Date | null}): Promise<ShiftRow> {
    const changed = await this.tx.shift.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.expectedVersion, state: 'PLANNED'}, data: {type: input.type,
      plannedStartAt: input.plannedStartAt, plannedEndAt: input.plannedEndAt,
      lastEditedById: input.actorId, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  /** Оператор заявляет установку готовой и передаёт решение диспетчеру. */
  async requestAcceptance(tenantId: string, id: string, version: number, actorId: string, now: Date): Promise<ShiftRow> {
    const changed = await this.tx.shift.updateMany({where: {tenantId, id, version, state: 'PLANNED'},
      data: {state: 'PENDING_ACCEPTANCE', requestedAt: now, requestedById: actorId,
        declinedAt: null, declinedById: null, declineReason: null, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(tenantId, id));
    return this.get(tenantId, id);
  }

  /** Запуск возможен только из PENDING_ACCEPTANCE: допуск нельзя обойти. */
  async start(tenantId: string, id: string, version: number, actorId: string, now: Date): Promise<ShiftRow> {
    try {
      const changed = await this.tx.shift.updateMany({where: {tenantId, id, version, state: 'PENDING_ACCEPTANCE'},
        data: {state: 'STARTED', startedAt: now, startedById: actorId, version: {increment: 1}}});
      if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(tenantId, id));
      return this.get(tenantId, id);
    } catch (error) {
      if ((error as {code?: string}).code === 'P2002') throw conflict('По этой установке уже открыта смена');
      throw error;
    }
  }

  /** Диспетчер отказывает в допуске: смена возвращается оператору с причиной. */
  async decline(input: {tenantId: string; id: string; version: number; actorId: string; reason: string; now: Date}) {
    const changed = await this.tx.shift.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: 'PENDING_ACCEPTANCE'}, data: {state: 'PLANNED',
      declinedAt: input.now, declinedById: input.actorId, declineReason: input.reason, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async cancel(input: {tenantId: string; id: string; version: number; actorId: string; reason: string; now: Date}) {
    const changed = await this.tx.shift.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: {in: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED']}}, data: {state: 'CANCELLED',
      cancelledAt: input.now, cancelledById: input.actorId, cancelReason: input.reason, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async markHandoverPending(tenantId: string, id: string, version: number): Promise<ShiftRow> {
    const changed = await this.tx.shift.updateMany({where: {tenantId, id, version, state: 'STARTED'},
      data: {state: 'HANDOVER_PENDING', version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(tenantId, id));
    return this.get(tenantId, id);
  }

  async close(tenantId: string, id: string, version: number, actorId: string, now: Date): Promise<ShiftRow> {
    const changed = await this.tx.shift.updateMany({where: {tenantId, id, version, state: 'HANDOVER_PENDING'},
      data: {state: 'CLOSED', closedAt: now, closedById: actorId, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(tenantId, id));
    return this.get(tenantId, id);
  }

  async reopen(tenantId: string, id: string, version: number): Promise<ShiftRow> {
    const changed = await this.tx.shift.updateMany({where: {tenantId, id, version, state: 'HANDOVER_PENDING'},
      data: {state: 'STARTED', version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Смена изменилась. Обновите страницу и повторите действие', await this.safeCurrent(tenantId, id));
    return this.get(tenantId, id);
  }

  private safeCurrent(tenantId: string, id: string) {
    return this.tx.shift.findFirst({where: {tenantId, id}, select: {id: true, state: true, version: true,
      startedAt: true, startedById: true, closedAt: true, closedById: true, updatedAt: true}});
  }
}
