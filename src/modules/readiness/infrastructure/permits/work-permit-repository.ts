import {randomUUID} from 'node:crypto';
import type {Prisma, WorkPermitApprovalRole} from '@/generated/postgres-client/client';
import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {ReadinessTransaction} from '../tenant-transaction';
import type {
  WorkPermitApprovalRecord,
  WorkPermitContent,
  WorkPermitRecord,
} from '../../domain/permits/types';

const includeApprovals = {approvals: {orderBy: {approvedAt: 'asc' as const}}};

type PermitRow = Prisma.WorkPermitGetPayload<{include: typeof includeApprovals}>;

export const toWorkPermitRecord = (row: PermitRow): WorkPermitRecord => ({
  id: row.id,
  tenantId: row.tenantId,
  equipmentId: row.equipmentId,
  shiftId: row.shiftId,
  risk: row.risk,
  state: row.state,
  scope: row.scope,
  validFrom: row.validFrom,
  validTo: row.validTo,
  timezone: row.timezone,
  authorId: row.authorId,
  lastEditedById: row.lastEditedById,
  version: row.version,
  approvals: row.approvals.map((approval): WorkPermitApprovalRecord => ({
    role: approval.role,
    approvedById: approval.approvedById,
    permitVersion: approval.permitVersion,
    valid: approval.valid,
  })),
});

export class WorkPermitRepository {
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

  async tenantTimezone(tenantId: string): Promise<string> {
    const settings = await this.tx.tenantSettings.findUnique({
      where: {tenantId}, select: {timezone: true},
    });
    if (!settings?.timezone) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Tenant timezone is unavailable');
    return settings.timezone;
  }

  async create(input: WorkPermitContent & {tenantId: string; timezone: string; actorId: string}): Promise<PermitRow> {
    return this.tx.workPermit.create({
      data: {
        id: randomUUID(), tenantId: input.tenantId, equipmentId: input.equipmentId,
        shiftId: input.shiftId ?? null, risk: input.risk, scope: input.scope,
        validFrom: input.validFrom, validTo: input.validTo, timezone: input.timezone,
        authorId: input.actorId, lastEditedById: input.actorId,
      },
      include: includeApprovals,
    });
  }

  async get(tenantId: string, id: string): Promise<PermitRow> {
    const permit = await this.tx.workPermit.findFirst({where: {tenantId, id}, include: includeApprovals});
    if (!permit) throw new ReadinessCommandError('VALIDATION_ERROR', 404, 'Resource not found');
    return permit;
  }

  async list(input: {
    tenantId: string; equipmentId?: string; state?: WorkPermitRecord['state'];
    risk?: WorkPermitRecord['risk']; limit: number; cursor?: {updatedAt: Date; id: string};
  }): Promise<{rows: PermitRow[]; total: number}> {
    const where: Prisma.WorkPermitWhereInput = {
      tenantId: input.tenantId,
      ...(input.equipmentId ? {equipmentId: input.equipmentId} : {}),
      ...(input.state ? {state: input.state} : {}),
      ...(input.risk ? {risk: input.risk} : {}),
      ...(input.cursor ? {OR: [
        {updatedAt: {lt: input.cursor.updatedAt}},
        {updatedAt: input.cursor.updatedAt, id: {lt: input.cursor.id}},
      ]} : {}),
    };
    const [rows, total] = await Promise.all([
      this.tx.workPermit.findMany({
        where, include: includeApprovals, orderBy: [{updatedAt: 'desc'}, {id: 'desc'}], take: input.limit + 1,
      }),
      this.tx.workPermit.count({where: {...where, OR: undefined}}),
    ]);
    return {rows, total};
  }

  async updateContent(input: {
    tenantId: string; id: string; expectedVersion: number; actorId: string;
    content: WorkPermitContent; nextVersion: number; invalidateApprovals: boolean;
  }): Promise<PermitRow> {
    const now = new Date();
    const updated = await this.tx.workPermit.updateMany({
      where: {tenantId: input.tenantId, id: input.id, version: input.expectedVersion},
      data: {
        ...input.content, shiftId: input.content.shiftId ?? null,
        version: input.nextVersion, state: 'DRAFT', lastEditedById: input.actorId,
        submittedAt: null, approvedAt: null, revokedAt: null, revokedById: null, revokeReason: null,
      },
    });
    if (updated.count !== 1) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Permit version conflict');
    if (input.invalidateApprovals) {
      await this.tx.workPermitApproval.updateMany({
        where: {tenantId: input.tenantId, permitId: input.id, valid: true},
        data: {valid: false, invalidatedAt: now, invalidationReason: 'PERMIT_CONTENT_CHANGED'},
      });
    }
    return this.get(input.tenantId, input.id);
  }

  async submit(tenantId: string, id: string, version: number): Promise<PermitRow> {
    const updated = await this.tx.workPermit.updateMany({
      where: {tenantId, id, version, state: 'DRAFT'},
      data: {state: 'PENDING_APPROVAL', submittedAt: new Date()},
    });
    if (updated.count !== 1) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Permit submit conflict');
    return this.get(tenantId, id);
  }

  async addApproval(input: {
    tenantId: string; permitId: string; permitVersion: number;
    role: WorkPermitApprovalRole; actorId: string;
  }): Promise<void> {
    try {
      await this.tx.workPermitApproval.create({data: {
        id: randomUUID(), tenantId: input.tenantId, permitId: input.permitId,
        permitVersion: input.permitVersion, role: input.role, approvedById: input.actorId,
      }});
    } catch (error) {
      if ((error as {code?: string}).code === 'P2002') {
        throw new ReadinessCommandError('VERSION_CONFLICT', 409, `${input.role} approval already exists`);
      }
      throw error;
    }
  }

  async markApproved(tenantId: string, id: string, version: number): Promise<PermitRow> {
    const updated = await this.tx.workPermit.updateMany({
      where: {tenantId, id, version, state: 'PENDING_APPROVAL'},
      data: {state: 'APPROVED', approvedAt: new Date()},
    });
    if (updated.count !== 1) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Permit approval conflict');
    return this.get(tenantId, id);
  }

  async revoke(input: {tenantId: string; id: string; version: number; actorId: string; reason: string}): Promise<PermitRow> {
    const updated = await this.tx.workPermit.updateMany({
      where: {tenantId: input.tenantId, id: input.id, version: input.version, state: 'APPROVED'},
      data: {state: 'REVOKED', revokedAt: new Date(), revokedById: input.actorId, revokeReason: input.reason},
    });
    if (updated.count !== 1) throw new ReadinessCommandError('VERSION_CONFLICT', 409, 'Permit revoke conflict');
    return this.get(input.tenantId, input.id);
  }
}
