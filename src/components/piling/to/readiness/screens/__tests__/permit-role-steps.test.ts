import {describe, expect, it} from 'vitest';
import type {WorkPermitDto} from '../../api/contracts';
import {buildPermitRoleSteps, isOverduePermit} from '../permit-role-steps';

const NOW = new Date('2026-10-10T09:00:00.000Z');
const permit = (state: WorkPermitDto['state'], validTo: string, extra: Partial<WorkPermitDto> = {}) =>
  ({id: `p-${state}-${validTo}`, equipmentId: 'eq-1', state, validTo, risk: 'NORMAL', scope: 'Монтаж', approvals: [], ...extra} as unknown as WorkPermitDto);
const PAST = '2026-10-09T09:00:00.000Z';
const FUTURE = '2026-10-11T09:00:00.000Z';
const role = (label: string, permits: WorkPermitDto[]) => {
  const found = buildPermitRoleSteps({permits, now: NOW}).find((item) => item.label === label);
  if (!found) throw new Error(label);
  return found;
};

describe('просроченные наряды', () => {
  it('просрочен наряд на согласовании или согласованный с прошедшим сроком; черновик, отозванный и действующий — нет', () => {
    expect(isOverduePermit(permit('PENDING_APPROVAL', PAST), NOW)).toBe(true);
    expect(isOverduePermit(permit('APPROVED', PAST), NOW)).toBe(true);
    expect(isOverduePermit(permit('EXPIRED', PAST), NOW)).toBe(true);
    expect(isOverduePermit(permit('DRAFT', PAST), NOW)).toBe(false);
    expect(isOverduePermit(permit('REVOKED', PAST), NOW)).toBe(false);
    expect(isOverduePermit(permit('APPROVED', FUTURE), NOW)).toBe(false);
  });
});

describe('шаги ролей на вкладке «Наряд-допуски»', () => {
  it('диспетчер: просроченный наряд на согласовании не считается ожидающим решения — согласовать его нельзя', () => {
    const dispatcher = role('Диспетчер', [permit('PENDING_APPROVAL', PAST)]);
    expect(dispatcher.steps.find((step) => step.title === 'Согласовать наряд')?.done).toBe(true);
    expect(dispatcher.steps.find((step) => step.title === 'Решить по просроченным')?.done).toBe(false);
  });

  it('диспетчер: живой наряд на согласовании — шаг не выполнен, подсказка называет кнопку', () => {
    const dispatcher = role('Диспетчер', [permit('PENDING_APPROVAL', FUTURE)]);
    const step = dispatcher.steps.find((item) => item.title === 'Согласовать наряд');
    expect(step?.done).toBe(false);
    expect(step?.hint).toContain('Согласовать');
  });

  it('инженер ОТ: черновик — шаг «Отправить на согласование» не выполнен', () => {
    const engineer = role('Инженер ОТ или механик', [permit('DRAFT', FUTURE)]);
    expect(engineer.steps.find((step) => step.title === 'Отправить на согласование')?.done).toBe(false);
  });

  it('инженер ОТ: просроченные требуют нового наряда', () => {
    const engineer = role('Инженер ОТ или механик', [permit('EXPIRED', PAST)]);
    const step = engineer.steps.find((item) => item.title === 'Переоформить просроченные');
    expect(step?.done).toBe(false);
    expect(step?.hint).toContain('новый наряд');
  });

  it('администратор: повышенный риск с одним решением — второе решение за ним', () => {
    const admin = role('Администратор', [permit('PENDING_APPROVAL', FUTURE, {risk: 'ELEVATED'})]);
    expect(admin.steps.find((step) => step.title === 'Второе решение при повышенном риске')?.done).toBe(false);
  });

  it('нарядов нет — у диспетчера делать нечего', () => {
    const dispatcher = role('Диспетчер', []);
    expect(dispatcher.steps.map((step) => step.done)).toEqual([true, true]);
  });
});
