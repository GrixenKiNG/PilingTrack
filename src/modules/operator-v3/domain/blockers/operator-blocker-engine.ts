import type {OperatorBlocker, OperatorChecklistAnswer} from '../contracts';
import type {OperatorChecklistItemDefinition} from '../checklists/operator-checklist-types';

export function evaluateOperatorChecklistBlockers(
  item: OperatorChecklistItemDefinition,
  answer: OperatorChecklistAnswer,
): OperatorBlocker[] {
  if (!isOperatorChecklistFailure(answer.result)) {
    return [];
  }

  return [{
    id: `checklist:${item.id}:${item.ruleCode ?? 'failure'}`,
    source: 'CHECKLIST',
    itemId: item.id,
    reason: answer.note?.trim() || item.text,
    severity: item.criticality,
    createdAt: answer.answeredAt,
    resolution: null,
    blocking: item.criticality === 'CRITICAL' || item.ruleCode !== null,
    ruleCode: item.ruleCode,
  }];
}

export function isOperatorChecklistFailure(result: string): boolean {
  return result === 'FAIL' || result === 'DEFECT' || result === 'PROBLEM';
}
