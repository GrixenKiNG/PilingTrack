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
    if (!row) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Resource not found');
    return row;
  }

  async createSubmitted(input: {tenantId: string; shiftId: string; summary: string;
    evidence: Prisma.InputJsonValue; actorId: string; now: Date}): Promise<HandoverRow> {
    try {
      return await this.tx.shiftHandover.create({data: {id: randomUUID(), tenantId: input.tenantId,
        shiftId: input.shiftId, summary: input.summary, evidence: input.evidence,
        submittedById: input.actorId, submittedAt: input.now, state: 'SUBMITTED'}});
    } catch (error) {
      if ((error as {code?: string}).code === 'P2002') throw conflict('Shift already has a live handover');
      throw error;
    }
  }

  async accept(input: {tenantId: string; id: string; version: number; actorId: string; now: Date}) {
    const changed = await this.tx.shiftHandover.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: 'SUBMITTED'}, data: {state: 'ACCEPTED', acceptedById: input.actorId,
      acceptedAt: input.now, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Handover accept conflict', await this.safeCurrent(input.tenantId, input.id));
    return this.get(input.tenantId, input.id);
  }

  async rework(input: {tenantId: string; id: string; version: number; actorId: string; reason: string; now: Date}) {
    const changed = await this.tx.shiftHandover.updateMany({where: {tenantId: input.tenantId, id: input.id,
      version: input.version, state: 'SUBMITTED'}, data: {state: 'REWORK_REQUIRED', reworkedById: input.actorId,
      reworkedAt: input.now, reworkReason: input.reason, version: {increment: 1}}});
    if (changed.count !== 1) throw conflict('Handover rework conflict', await this.safeCurrent(input.tenantId, input.id));
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
