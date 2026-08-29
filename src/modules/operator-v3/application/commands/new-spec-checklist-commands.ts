import type {
  CompleteOperatorChecklistExecutionInput,
  SaveOperatorChecklistAnswerInput,
  StartOperatorChecklistExecutionInput,
} from '../../infrastructure/operator-checklist-repository';
import type {OperatorChecklistAnswer} from '../../domain/contracts';
import type {
  OperatorCommandAdapterInput,
  OperatorCommandAdapterResult,
  OperatorCommandDefinition,
  OperatorCommandRegistry,
  OperatorV3CommandName,
} from './operator-command-registry';

export interface NewSpecChecklistCommandStore {
  startExecution(input: StartOperatorChecklistExecutionInput): Promise<unknown>;
  saveAnswer(input: SaveOperatorChecklistAnswerInput): Promise<unknown>;
  completeExecution(input: CompleteOperatorChecklistExecutionInput): Promise<unknown>;
}

export function createNewSpecChecklistCommandRegistry(
  store: NewSpecChecklistCommandStore,
): OperatorCommandRegistry {
  const executeStart = async (input: OperatorCommandAdapterInput): Promise<OperatorCommandAdapterResult> => {
    const payload = input.envelope.payload as {
      executionId: string; shiftId: string; equipmentId: string; templateId: string;
    };
    await store.startExecution({
      id: payload.executionId,
      tenantId: input.context.tenantId,
      shiftId: payload.shiftId,
      equipmentId: payload.equipmentId,
      templateId: payload.templateId,
      clientCommandId: input.envelope.commandId,
      startedById: input.context.actorId,
      startedAt: new Date(input.envelope.occurredAt),
    });
    return {newVersion: input.envelope.expectedVersion + 1, createdEvents: ['Проверка начата']};
  };

  const executeAnswer = async (input: OperatorCommandAdapterInput): Promise<OperatorCommandAdapterResult> => {
    const payload = input.envelope.payload as {executionId: string; answer: OperatorChecklistAnswer};
    await store.saveAnswer({
      id: `${input.context.tenantId}:${input.envelope.commandId}`,
      tenantId: input.context.tenantId,
      executionId: payload.executionId,
      clientCommandId: input.envelope.commandId,
      answeredById: input.context.actorId,
      answer: payload.answer,
    });
    return {newVersion: input.envelope.expectedVersion + 1, createdEvents: ['Ответ проверки сохранён']};
  };

  const executeComplete = async (input: OperatorCommandAdapterInput): Promise<OperatorCommandAdapterResult> => {
    const payload = input.envelope.payload as {executionId: string};
    await store.completeExecution({
      tenantId: input.context.tenantId,
      id: payload.executionId,
      completedAt: new Date(input.envelope.occurredAt),
    });
    return {newVersion: input.envelope.expectedVersion + 1, createdEvents: ['Проверка завершена']};
  };

  const definitions: Array<[OperatorV3CommandName, OperatorCommandDefinition]> = [
    ['start-checklist', {critical: false, execute: executeStart}],
    ['save-checklist-answer', {critical: false, execute: executeAnswer}],
    ['complete-checklist', {critical: true, execute: executeComplete}],
  ];
  return new Map(definitions);
}
