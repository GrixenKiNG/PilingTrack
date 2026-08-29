import {describe, expect, it} from 'vitest';
import type {OperatorChecklistAnswer} from '../../contracts';
import type {OperatorChecklistItemDefinition} from '../../checklists/operator-checklist-types';
import {evaluateOperatorChecklistBlockers} from '../operator-blocker-engine';

const failedAnswer: OperatorChecklistAnswer = {
  itemId: 'hydraulics-hose-integrity',
  result: 'FAIL',
  value: null,
  note: 'Повреждение до корда',
  mediaIds: ['media-1'],
  answeredAt: '2026-08-29T09:00:00.000Z',
};

function checklistItem(overrides: Partial<OperatorChecklistItemDefinition>): OperatorChecklistItemDefinition {
  return {
    id: 'hydraulics-hose-integrity',
    text: 'Рукава высокого давления исправны',
    answerType: 'PASS_FAIL_NA',
    criticality: 'IMPORTANT',
    required: true,
    photoOnFailure: true,
    unit: null,
    ruleCode: null,
    ...overrides,
  };
}

describe('движок блокировок чек-листа', () => {
  it('запрещает продолжение при критическом дефекте', () => {
    expect(evaluateOperatorChecklistBlockers(
      checklistItem({criticality: 'CRITICAL'}),
      failedAnswer,
    )).toContainEqual(expect.objectContaining({
      source: 'CHECKLIST',
      severity: 'CRITICAL',
      blocking: true,
    }));
  });

  it('создаёт неблокирующее предупреждение для важного дефекта без правила', () => {
    expect(evaluateOperatorChecklistBlockers(
      checklistItem({criticality: 'IMPORTANT'}),
      failedAnswer,
    )).toContainEqual(expect.objectContaining({
      severity: 'IMPORTANT',
      blocking: false,
    }));
  });

  it('блокирует важный дефект, если это требует правило шаблона', () => {
    expect(evaluateOperatorChecklistBlockers(
      checklistItem({criticality: 'IMPORTANT', ruleCode: 'SITE_FOUNDATION_REQUIRED'}),
      failedAnswer,
    )).toContainEqual(expect.objectContaining({
      severity: 'IMPORTANT',
      blocking: true,
      ruleCode: 'SITE_FOUNDATION_REQUIRED',
    }));
  });
});
