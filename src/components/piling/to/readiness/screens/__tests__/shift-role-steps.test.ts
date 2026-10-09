import {describe, expect, it} from 'vitest';
import type {CurrentReadinessDto, DefectDto, ReadinessShiftDto} from '../../api/contracts';
import {buildShiftRoleSteps, firstPendingStep} from '../shift-role-steps';

const shift = (state: ReadinessShiftDto['state'], equipmentId = 'eq-1') =>
  ({id: `s-${state}-${equipmentId}`, equipmentId, state} as ReadinessShiftDto);
const readiness = (equipmentId: string, inspectionCompleted: boolean) =>
  ({equipmentId, facts: {inspectionCompleted}} as unknown as CurrentReadinessDto);
const defect = (status: DefectDto['status'], severity: DefectDto['severity'] = 'NORMAL') =>
  ({id: `d-${status}-${severity}`, status, severity} as DefectDto);

const role = (label: string, input: Parameters<typeof buildShiftRoleSteps>[0]) => {
  const found = buildShiftRoleSteps(input).find((item) => item.label === label);
  if (!found) throw new Error('нет роли ' + label);
  return found;
};
const base = {currentReadiness: [], defects: [], defectsError: null};

describe('шаги ролей на вкладке «Смены»', () => {
  it('без смен шаги смен не выполнены и не отменены — данных нет', () => {
    const operator = role('Оператор', {...base, shifts: []});
    expect(operator.steps.map((step) => step.done)).toEqual([null, null, null]);
    expect(firstPendingStep(operator)).toBeNull();
  });

  it('новая смена после закрытой: первый невыполненный шаг оператора — осмотр', () => {
    const operator = role('Оператор', {
      ...base,
      shifts: [shift('PENDING_ACCEPTANCE')],
      currentReadiness: [readiness('eq-1', false)],
    });
    expect(operator.steps.map((step) => step.done)).toEqual([true, false, false]);
    expect(firstPendingStep(operator)?.title).toBe('Провести осмотр');
  });

  it('шаг считается сделанным только по каждой смене', () => {
    const operator = role('Оператор', {
      ...base,
      shifts: [shift('CLOSED', 'eq-1'), shift('PLANNED', 'eq-2')],
    });
    expect(operator.steps[0].done).toBe(false);
    expect(operator.steps[2].done).toBe(false);
  });

  it('диспетчер: смена ждёт допуска — шаг «Запустить смену» не выполнен и подсказывает про причины отказа', () => {
    const dispatcher = role('Диспетчер', {...base, shifts: [shift('PENDING_ACCEPTANCE')]});
    const pending = firstPendingStep(dispatcher);
    expect(pending?.title).toBe('Проверить готовность');
    expect(dispatcher.steps[2]).toMatchObject({title: 'Запустить смену', done: false});
    expect(dispatcher.steps[2].hint).toContain('причины');
  });

  it('механик: журнал дефектов не прочитан — шаги не выполнены и не просрочены', () => {
    const mechanic = role('Механик', {...base, shifts: [], defects: [], defectsError: 'нет доступа'});
    expect(mechanic.steps.map((step) => step.done)).toEqual([null, null, null]);
  });

  it('механик: открытый критический дефект блокирует возврат техники', () => {
    const mechanic = role('Механик', {...base, shifts: [], defects: [defect('OPEN', 'CRITICAL')]});
    expect(mechanic.steps.map((step) => step.done)).toEqual([false, true, false]);
    expect(firstPendingStep(mechanic)?.title).toBe('Устранить дефект');
  });
});
