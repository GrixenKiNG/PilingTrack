import {describe, expect, it} from 'vitest';
import type {WorkPermitDto} from '../../api/contracts';
import {buildPermitRoleSteps, isOverduePermit, permitSigningBlock} from '../permit-role-steps';

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

  it('инженер ОТ: согласованный наряд с прошедшим сроком требует нового наряда', () => {
    const engineer = role('Инженер ОТ или механик', [permit('APPROVED', PAST)]);
    const step = engineer.steps.find((item) => item.title === 'Переоформить просроченные');
    expect(step?.done).toBe(false);
    expect(step?.hint).toContain('новый наряд');
  });

  it('инженер ОТ: истёкший наряд — история, переоформлять нечего', () => {
    const engineer = role('Инженер ОТ или механик', [permit('EXPIRED', PAST)]);
    expect(engineer.steps.find((item) => item.title === 'Переоформить просроченные')?.done).toBe(true);
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

describe('permitSigningBlock — кто уже подписал, тот вторую подпись не поставит', () => {
  const twoSigns = (approvals: WorkPermitDto['approvals'], extra: Partial<WorkPermitDto> = {}) =>
    permit('PENDING_APPROVAL', FUTURE, {risk: 'ELEVATED', requiredApprovals: ['DISPATCHER', 'ADMIN'], version: 1, approvals, ...extra});
  const sign = (role: 'DISPATCHER' | 'ADMIN', approvedById: string, over: Partial<WorkPermitDto['approvals'][number]> = {}) =>
    ({role, approvedById, approvedAt: '2026-10-15T17:56:00.000Z', valid: true, permitVersion: 1, ...over});
  const actor = (id: string) => ({id, role: 'ADMIN', actingAs: null});

  it('объясняет подписавшему, что остальные подписи нужны от других людей', () => {
    const text = permitSigningBlock(twoSigns([sign('DISPATCHER', 'admin-1')]), actor('admin-1'));
    expect(text).toContain('«Диспетчер»');
    expect(text).toContain('Администратор');
  });

  it('другому человеку подпись не запрещает', () => {
    expect(permitSigningBlock(twoSigns([sign('DISPATCHER', 'admin-1')]), actor('admin-2'))).toBeNull();
  });

  it('при одной обязательной подписи ограничения нет', () => {
    expect(permitSigningBlock(twoSigns([sign('DISPATCHER', 'admin-1')], {requiredApprovals: ['DISPATCHER']}), actor('admin-1'))).toBeNull();
  });

  it('подпись прежней версии или аннулированная не считается', () => {
    expect(permitSigningBlock(twoSigns([sign('DISPATCHER', 'admin-1', {permitVersion: 0})]), actor('admin-1'))).toBeNull();
    expect(permitSigningBlock(twoSigns([sign('DISPATCHER', 'admin-1', {valid: false})]), actor('admin-1'))).toBeNull();
  });
});
