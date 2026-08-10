import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/postgres-client/client';
import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {ReadinessTransaction} from '../tenant-transaction';

export type HandoverRow = Prisma.ShiftHandoverGetPayload<object>;
const conflict = (message: string, current?: unknown) =>
  new ReadinessCommandError('VERSION_CONFLICT', 409, message, current ? {current} : undefined);

export class HandoverRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async get(tenantId: string, id: string): Promise<HandoverRow> {
    const row = await this.tx.shiftHandover.findFirst({where: {tenantId, id}});
    if (!row) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Запись не найдена');
    return row;
  }

  async createSubmitted(input: {tenantId: string; shiftId: string; summary: string;
    evidence: Prisma.InputJsonValue; actorId: string; now: Date}): Promise<HandoverRow> {
    try {
      return await this.tx.shiftHandover.create({data: {id: randomUUID(), tenantId: input.tenantId,
        shiftId: input.shiftId, summary: input.summary, evidence: input.evidence,
        submittedById: input.actorId, submittedAt: input.now, state: 'SUBMITTED'}});
    } catch (error) {
      if ((error as {code?: string}).code === 'P2002') throw conflict('По этой смене уже есть незакрытая передача');
      throw error;
    }
  }

  /**
   * Живая передача смены — та, что ещё не принята. Индекс
   * `ShiftHandover_one_live_per_shift_key` разрешает такую только одну.
   */
  async findLive(tenantId: string, shiftId: string): Promise<HandoverRow | null> {
    return this.tx.shiftHandover.findFirst({where: {tenantId, shiftId,
      state: {in: ['DRAFT', 'SUBMITTED', 'REWORK_REQUIRED']}}});
  }

  /**
   * Повторная передача после возврата на доработку: та же запись меняет
   * состояние, а не заводится вторая. Второй строки индекс и не допустил бы —
   * раньше из-за этого возврат на доработку был дорогой в один конец.
   */
  async resubmit(input: {tenantId: string; id: string; version: number; summary: string;
    evidence: Prisma.InputJsonValue; actorId: string; now: Date}): Promise<HandoverRow> {
    const changed = await this.tx.shiftHandover.updateMany({
      where: {tenantId: input.tenantId, id: input.id, version: input.version, state: 'REWORK_REQUIRED'},
      data: {state: 'SUBMITTED', summary: input.summary, evidence: input.evidence,
        submittedById: input.actorId, submittedAt: input.now, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Передача изменилась. Обновите страницу и повторите действие',
      await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async accept(input: {tenantId: string; id: string; version: number; actorId: string; now: Date}) {
    const changed = await this.tx.shiftHandover.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: 'SUBMITTED'}, data: {state: 'ACCEPTED', acceptedById: input.actorId,
      acceptedAt: input.now, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Передача изменилась. Обновите страницу и повторите действие', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async rework(input: {tenantId: string; id: string; version: number; actorId: string; reason: string; now: Date}) {
    const changed = await this.tx.shiftHandover.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: 'SUBMITTED'}, data: {state: 'REWORK_REQUIRED', reworkedById: input.actorId,
      reworkedAt: input.now, reworkReason: input.reason, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Передача изменилась. Обновите страницу и повторите действие', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async safeCurrent(tenantId: string, id: string) {
    const current = await this.tx.shiftHandover.findFirst({where: {tenantId, id}, select: {id: true, shiftId: true, state: true,
      version: true, acceptedById: true, acceptedAt: true, reworkedById: true, reworkedAt: true, updatedAt: true}});
    return current ? {
      ...current,
      acceptedAt: current.acceptedAt?.toISOString() ?? null,
      reworkedAt: current.reworkedAt?.toISOString() ?? null,
      updatedAt: current.updatedAt.toISOString(),
    } : null;
  }
}
