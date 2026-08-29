import {Prisma} from '@/generated/postgres-client/client';
import type {PrismaClient} from '@/generated/postgres-client/client';
import type {OperatorChecklistAnswer} from '../domain/contracts';

type OperatorChecklistStore = Pick<PrismaClient, 'operatorChecklistTemplate' | 'operatorChecklistExecution' | 'operatorChecklistAnswerRecord'>;

export interface PublishOperatorChecklistTemplateInput {
  id: string; tenantId: string; templateKey: string; version: string; stage: string;
  equipmentModel: string; technology: string | null; definition: unknown; createdById: string;
}

export interface StartOperatorChecklistExecutionInput {
  id: string; tenantId: string; shiftId: string; equipmentId: string; templateId: string;
  clientCommandId: string; startedById: string; startedAt: Date;
}

export interface SaveOperatorChecklistAnswerInput {
  id: string; tenantId: string; executionId: string; clientCommandId: string;
  answeredById: string; answer: OperatorChecklistAnswer;
}

export interface CompleteOperatorChecklistExecutionInput {
  tenantId: string; id: string; completedAt: Date;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findItemSnapshot(snapshot: Prisma.JsonValue, itemId: string): Record<string, unknown> {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.sections)) {
    throw new Error('Снимок шаблона проверки повреждён');
  }
  for (const section of snapshot.sections) {
    if (!isRecord(section) || !Array.isArray(section.items)) continue;
    const item = section.items.find((candidate) => isRecord(candidate) && candidate.id === itemId);
    if (isRecord(item)) return item;
  }
  throw new Error('Пункт отсутствует в снимке шаблона проверки');
}

export class OperatorChecklistRepository {
  constructor(private readonly db: OperatorChecklistStore) {}

  async publishTemplate(input: PublishOperatorChecklistTemplateInput) {
    const existing = await this.db.operatorChecklistTemplate.findUnique({
      where: {tenantId_templateKey_version: {
        tenantId: input.tenantId, templateKey: input.templateKey, version: input.version,
      }},
    });
    if (existing) return existing;
    return this.db.operatorChecklistTemplate.create({data: {
      id: input.id, tenantId: input.tenantId, templateKey: input.templateKey,
      version: input.version, stage: input.stage, equipmentModel: input.equipmentModel,
      technology: input.technology, definition: toInputJson(input.definition), createdById: input.createdById,
    }});
  }

  async startExecution(input: StartOperatorChecklistExecutionInput) {
    const existing = await this.db.operatorChecklistExecution.findUnique({
      where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
    });
    if (existing) return existing;
    const template = await this.db.operatorChecklistTemplate.findFirst({
      where: {tenantId: input.tenantId, id: input.templateId},
    });
    if (!template) throw new Error('Шаблон проверки не найден в организации');
    return this.db.operatorChecklistExecution.create({data: {
      id: input.id, tenantId: input.tenantId, shiftId: input.shiftId,
      equipmentId: input.equipmentId, templateId: input.templateId,
      clientCommandId: input.clientCommandId, templateSnapshot: toInputJson(template.definition),
      startedById: input.startedById, startedAt: input.startedAt,
    }});
  }

  async saveAnswer(input: SaveOperatorChecklistAnswerInput) {
    const existing = await this.db.operatorChecklistAnswerRecord.findUnique({
      where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
    });
    if (existing) return existing;
    const execution = await this.db.operatorChecklistExecution.findFirst({
      where: {tenantId: input.tenantId, id: input.executionId}, select: {templateSnapshot: true},
    });
    if (!execution) throw new Error('Выполнение проверки не найдено в организации');
    const itemSnapshot = findItemSnapshot(execution.templateSnapshot, input.answer.itemId);
    return this.db.operatorChecklistAnswerRecord.create({data: {
      id: input.id, tenantId: input.tenantId, executionId: input.executionId,
      itemId: input.answer.itemId, clientCommandId: input.clientCommandId,
      result: input.answer.result, value: input.answer.value === null ? Prisma.JsonNull : input.answer.value,
      note: input.answer.note, mediaIds: toInputJson(input.answer.mediaIds),
      itemSnapshot: toInputJson(itemSnapshot), answeredAt: new Date(input.answer.answeredAt),
      answeredById: input.answeredById,
    }});
  }

  async completeExecution(input: CompleteOperatorChecklistExecutionInput) {
    const execution = await this.db.operatorChecklistExecution.findFirst({
      where: {tenantId: input.tenantId, id: input.id},
    });
    if (!execution) throw new Error('Выполнение проверки не найдено в организации');
    if (execution.status === 'COMPLETED') return execution;
    if (execution.status !== 'IN_PROGRESS') throw new Error('Проверку нельзя завершить из текущего состояния');
    await this.db.operatorChecklistExecution.updateMany({
      where: {tenantId: input.tenantId, id: input.id, status: 'IN_PROGRESS'},
      data: {status: 'COMPLETED', completedAt: input.completedAt},
    });
    const completed = await this.db.operatorChecklistExecution.findFirst({
      where: {tenantId: input.tenantId, id: input.id},
    });
    if (!completed) throw new Error('Завершённая проверка не найдена в организации');
    return completed;
  }

  findExecution(input: {tenantId: string; id: string}) {
    return this.db.operatorChecklistExecution.findFirst({
      where: {tenantId: input.tenantId, id: input.id},
      include: {answers: {orderBy: {answeredAt: 'asc'}}},
    });
  }
}
