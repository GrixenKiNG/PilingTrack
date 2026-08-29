import type {OperatorBlocker, OperatorChecklistAnswer} from '../contracts';
import {evaluateOperatorChecklistBlockers, isOperatorChecklistFailure} from '../blockers/operator-blocker-engine';
import type {OperatorChecklistTemplateDefinition} from './operator-checklist-types';

export function evaluateChecklistExecution(
  template: OperatorChecklistTemplateDefinition,
  answers: OperatorChecklistAnswer[],
): {complete: boolean; blockers: OperatorBlocker[]; progress: {answered: number; total: number}} {
  const items = template.sections.flatMap((section) => section.items);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const answersByItemId = new Map<string, OperatorChecklistAnswer>();

  for (const answer of answers) {
    if (itemsById.has(answer.itemId) && answer.result.trim().length > 0) {
      answersByItemId.set(answer.itemId, answer);
    }
  }

  const blockers: OperatorBlocker[] = [];
  let complete = items.every((item) => !item.required || answersByItemId.has(item.id));

  for (const item of items) {
    const answer = answersByItemId.get(item.id);
    if (!answer) {
      continue;
    }

    blockers.push(...evaluateOperatorChecklistBlockers(item, answer));

    if (item.photoOnFailure && isOperatorChecklistFailure(answer.result) && answer.mediaIds.length === 0) {
      complete = false;
      blockers.push({
        id: `checklist:${item.id}:photo-required`,
        source: 'CHECKLIST',
        itemId: item.id,
        reason: 'Для дефекта нужна фотография',
        severity: item.criticality,
        createdAt: answer.answeredAt,
        resolution: null,
        blocking: true,
        ruleCode: 'PHOTO_REQUIRED_ON_FAILURE',
      });
    }
  }

  return {
    complete,
    blockers,
    progress: {answered: answersByItemId.size, total: items.length},
  };
}
