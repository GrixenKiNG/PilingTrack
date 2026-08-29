import type {RecordOperatorShiftEvidenceInput} from '../../infrastructure/operator-shift-evidence-repository';
import type {OperatorEvidenceKind} from '../../infrastructure/operator-shift-evidence-repository';
import type {
  OperatorCommandAdapterInput,
  OperatorCommandAdapterResult,
  OperatorCommandDefinition,
  OperatorCommandRegistry,
  OperatorV3CommandName,
} from './operator-command-registry';

export interface NewSpecWorkCommandStore {
  record(input: RecordOperatorShiftEvidenceInput): Promise<unknown>;
}

type EvidenceCommandName = Exclude<OperatorV3CommandName,
  | 'accept-assignment' | 'accept-equipment' | 'create-inspection' | 'save-inspection'
  | 'complete-inspection' | 'confirm-work-zone' | 'record-meter' | 'complete-preparation'
  | 'start-shift' | 'report-defect' | 'report-incident' | 'confirm-safe-stop'
  | 'record-production' | 'start-break' | 'start-downtime' | 'finish-interval'
  | 'complete-repair' | 'request-independent-check' | 'confirm-independent-check' | 'resume-work'
  | 'complete-report' | 'submit-handover' | 'accept-handover' | 'close-shift-without-recipient'
  | 'start-checklist' | 'save-checklist-answer' | 'complete-checklist'>;

const evidenceCommands: ReadonlyArray<{
  name: EvidenceCommandName;
  kind: OperatorEvidenceKind;
  critical: boolean;
  event: string;
}> = [
  {name: 'submit-knowledge-test', kind: 'KNOWLEDGE_TEST', critical: false, event: 'Проверка знаний сохранена'},
  {name: 'capture-weather', kind: 'WEATHER_SNAPSHOT', critical: false, event: 'Погода сохранена'},
  {name: 'confirm-site-check', kind: 'SITE_CHECK', critical: true, event: 'Площадка подтверждена'},
  {name: 'record-startup', kind: 'STARTUP_READING', critical: false, event: 'Запуск сохранён'},
  {name: 'record-warmup', kind: 'STARTUP_READING', critical: false, event: 'Прогрев сохранён'},
  {name: 'complete-function-check', kind: 'STARTUP_READING', critical: true, event: 'Функциональная проверка завершена'},
  {name: 'record-maintenance-action', kind: 'MAINTENANCE_ACTION', critical: false, event: 'Обслуживание сохранено'},
  {name: 'record-fluid-reading', kind: 'FLUID_READING', critical: false, event: 'Уровень жидкости сохранён'},
  {name: 'record-pile-driving', kind: 'PILE_DRIVING', critical: false, event: 'Забивка сваи сохранена'},
  {name: 'record-leader-drilling', kind: 'LEADER_DRILLING', critical: false, event: 'Лидерное бурение сохранено'},
];

function evidenceDefinition(
  store: NewSpecWorkCommandStore,
  command: typeof evidenceCommands[number],
): OperatorCommandDefinition {
  return {
    critical: command.critical,
    execute: async (input: OperatorCommandAdapterInput): Promise<OperatorCommandAdapterResult> => {
      const payload = input.envelope.payload as {shiftId: string; equipmentId: string} & Record<string, unknown>;
      await store.record({
        id: `${input.context.tenantId}:${input.envelope.commandId}`,
        tenantId: input.context.tenantId,
        shiftId: payload.shiftId,
        equipmentId: payload.equipmentId,
        kind: command.kind,
        payload: {...payload, commandName: command.name, commandChecksum: input.checksum},
        occurredAt: new Date(input.envelope.occurredAt),
        recordedById: input.context.actorId,
        clientCommandId: input.envelope.commandId,
      });
      return {newVersion: input.envelope.expectedVersion + 1, createdEvents: [command.event]};
    },
  };
}

export function createNewSpecWorkCommandRegistry(store: NewSpecWorkCommandStore): OperatorCommandRegistry {
  return new Map(evidenceCommands.map((command) => [command.name, evidenceDefinition(store, command)]));
}
