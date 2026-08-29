import type {OperatorCommandEnvelope} from './envelope-schema';

export const OPERATOR_V3_COMMAND_NAMES = [
  'accept-assignment',
  'accept-equipment',
  'create-inspection',
  'save-inspection',
  'complete-inspection',
  'confirm-work-zone',
  'record-meter',
  'complete-preparation',
  'start-shift',
  'report-defect',
  'report-incident',
  'confirm-safe-stop',
  'record-production',
  'start-break',
  'start-downtime',
  'finish-interval',
  'complete-repair',
  'request-independent-check',
  'confirm-independent-check',
  'resume-work',
  'complete-report',
  'submit-handover',
  'accept-handover',
  'close-shift-without-recipient',
  'start-checklist',
  'save-checklist-answer',
  'complete-checklist',
  'submit-knowledge-test',
  'capture-weather',
  'confirm-site-check',
  'record-startup',
  'record-warmup',
  'complete-function-check',
  'record-maintenance-action',
  'record-fluid-reading',
  'record-pile-driving',
  'record-leader-drilling',
] as const;

export type OperatorV3CommandName = typeof OPERATOR_V3_COMMAND_NAMES[number];

export const OPERATOR_V3_CAPTURE_ONLY_COMMAND_NAMES = [
  'record-production',
  'report-defect',
  'report-incident',
  'save-inspection',
  'start-checklist',
  'save-checklist-answer',
  'submit-knowledge-test',
  'capture-weather',
  'record-startup',
  'record-warmup',
  'record-maintenance-action',
  'record-fluid-reading',
  'record-pile-driving',
  'record-leader-drilling',
] as const satisfies readonly OperatorV3CommandName[];

export interface OperatorCommandContext {
  tenantId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  requestId: string;
  correlationId: string;
}

export interface OperatorCommandAdapterInput {
  envelope: OperatorCommandEnvelope;
  context: OperatorCommandContext;
  checksum: string;
}

export interface OperatorCommandAdapterResult {
  newVersion: number;
  createdEvents: string[];
}

export interface OperatorCommandDefinition {
  critical: boolean;
  execute(input: OperatorCommandAdapterInput): Promise<OperatorCommandAdapterResult>;
}

export type OperatorCommandRegistry = ReadonlyMap<string, OperatorCommandDefinition>;

export function isOperatorV3CommandName(value: string): value is OperatorV3CommandName {
  return (OPERATOR_V3_COMMAND_NAMES as readonly string[]).includes(value);
}

export function isOperatorV3CaptureOnlyCommand(value: string): boolean {
  return (OPERATOR_V3_CAPTURE_ONLY_COMMAND_NAMES as readonly string[]).includes(value);
}
