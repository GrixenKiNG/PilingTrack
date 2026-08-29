import {describe, expect, it} from 'vitest';
import type {OperatorChecklistItemDefinition, OperatorChecklistTemplateDefinition} from '../operator-checklist-types';
import {evaluateChecklistExecution} from '../checklist-execution';
import type {OperatorChecklistAnswer} from '../../contracts';

function templateWith(item: OperatorChecklistItemDefinition): OperatorChecklistTemplateDefinition {
  return {
    id: 'operator-v3:test',
    version: '2026.08.29',
    name: 'Тестовая проверка',
    stage: 'PRE_SHIFT',
    equipmentModel: 'PVE 50PR',
    technology: null,
    sections: [{id: 'test-section', title: 'Тестовый раздел', items: [item]}],
  };
}

function item(overrides: Partial<OperatorChecklistItemDefinition> = {}): OperatorChecklistItemDefinition {
  return {
    id: 'rope-integrity',
    text: 'Трос не имеет критических повреждений',
    answerType: 'PASS_FAIL_NA',
    criticality: 'NORMAL',
    required: true,
    photoOnFailure: true,
    unit: null,
    ruleCode: null,
    ...overrides,
  };
}

function answer(overrides: Partial<OperatorChecklistAnswer> = {}): OperatorChecklistAnswer {
  return {
    itemId: 'rope-integrity',
    result: 'PASS',
    value: null,
    note: null,
    mediaIds: [],
    answeredAt: '2026-08-29T09:00:00.000Z',
    ...overrides,
  };
}

describe('выполнение динамического чек-листа', () => {
  it('не завершает проверку без обязательного ответа', () => {
    expect(evaluateChecklistExecution(templateWith(item()), [])).toMatchObject({
      complete: false,
      progress: {answered: 0, total: 1},
    });
  });

  it('не завершает дефект без обязательной фотографии', () => {
    const result = evaluateChecklistExecution(templateWith(item()), [answer({result: 'FAIL'})]);

    expect(result.complete).toBe(false);
    expect(result.progress).toEqual({answered: 1, total: 1});
    expect(result.blockers).toContainEqual(expect.objectContaining({
      itemId: 'rope-integrity',
      reason: 'Для дефекта нужна фотография',
      blocking: true,
    }));
  });

  it('завершает сбор доказательств, но сохраняет критическую блокировку', () => {
    const result = evaluateChecklistExecution(
      templateWith(item({criticality: 'CRITICAL', ruleCode: 'ROPE_INTEGRITY_REQUIRED'})),
      [answer({result: 'FAIL', mediaIds: ['media-1']})],
    );

    expect(result.complete).toBe(true);
    expect(result.blockers).toContainEqual(expect.objectContaining({
      itemId: 'rope-integrity',
      severity: 'CRITICAL',
      blocking: true,
      ruleCode: 'ROPE_INTEGRITY_REQUIRED',
    }));
  });

  it('считает ответ «не применяется» завершённым и не требует фото', () => {
    expect(evaluateChecklistExecution(templateWith(item()), [answer({result: 'NA'})])).toEqual({
      complete: true,
      blockers: [],
      progress: {answered: 1, total: 1},
    });
  });
});
