import type {OperatorEvidenceKind as PrismaOperatorEvidenceKind, Prisma, PrismaClient} from '@/generated/postgres-client/client';

type OperatorShiftEvidenceStore = Pick<PrismaClient, 'operatorShiftEvidence'>;
export type OperatorEvidenceKind = PrismaOperatorEvidenceKind;

export interface RecordOperatorShiftEvidenceInput {
  id: string; tenantId: string; shiftId: string; equipmentId: string; kind: OperatorEvidenceKind;
  payload: unknown; occurredAt: Date; recordedById: string; clientCommandId: string;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class OperatorShiftEvidenceRepository {
  constructor(private readonly db: OperatorShiftEvidenceStore) {}

  async record(input: RecordOperatorShiftEvidenceInput) {
    const existing = await this.db.operatorShiftEvidence.findUnique({
      where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
    });
    if (existing) return existing;
    return this.db.operatorShiftEvidence.create({data: {
      id: input.id, tenantId: input.tenantId, shiftId: input.shiftId, equipmentId: input.equipmentId,
      kind: input.kind, payload: toInputJson(input.payload), occurredAt: input.occurredAt,
      recordedById: input.recordedById, clientCommandId: input.clientCommandId,
    }});
  }

  listForShift(input: {tenantId: string; shiftId: string}) {
    return this.db.operatorShiftEvidence.findMany({
      where: {tenantId: input.tenantId, shiftId: input.shiftId},
      orderBy: [{occurredAt: 'asc'}, {id: 'asc'}],
    });
  }
}
