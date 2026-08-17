import {describe, expect, it} from 'vitest';
import {assertCanApprovePermit, isApprovalComplete} from '../approval-policy';
import {transitionPermit} from '../transitions';
import {editPermit} from '../work-permit';
import type {WorkPermitRecord} from '../types';

const permit = (overrides: Partial<WorkPermitRecord> = {}): WorkPermitRecord => ({
  id: 'permit-1',
  tenantId: 'tenant-1',
  equipmentId: 'equipment-1',
  shiftId: null,
  workTypeId: 'work-type-1',
  risk: 'NORMAL',
  state: 'PENDING_APPROVAL',
  // Правило согласования теперь снимок настройки вида работ, а не следствие
  // риска. По умолчанию здесь — то же, что было зашито для обычных работ.
  requiredApprovals: ['DISPATCHER'],
  allowAuthorApproval: true,
  title: 'Замена шлангов',
  scope: 'Работы на площадке 7А',
  location: 'Площадка 7А',
  objectName: '',
  hazards: [],
  producerUserId: null,
  producerName: 'Смирнов А.В.',
  observerUserId: null,
  observerName: '',
  safetyUserId: null,
  safetyName: '',
  validFrom: new Date('2026-08-01T06:00:00.000Z'),
  validTo: new Date('2026-08-01T18:00:00.000Z'),
  timezone: 'Europe/Moscow',
  authorId: 'mechanic-1',
  lastEditedById: 'mechanic-1',
  version: 1,
  approvals: [],
  ...overrides,
});

describe('work permit state machine', () => {
  it.each([
    ['DRAFT', 'submit', 'PENDING_APPROVAL'],
    ['APPROVED', 'expire', 'EXPIRED'],
    ['APPROVED', 'revoke', 'REVOKED'],
  ] as const)('moves %s --%s--> %s', (from, command, expected) => {
    expect(transitionPermit(from, command)).toBe(expected);
  });

  it('approves with the single configured dispatcher signature', () => {
    const record = permit();
    expect(assertCanApprovePermit({
      permit: record,
      actorId: 'dispatcher-1',
      role: 'DISPATCHER',
      approvals: [],
    })).toBe('DISPATCHER');
    expect(isApprovalComplete(record, [{
      role: 'DISPATCHER', approvedById: 'dispatcher-1', permitVersion: 1, valid: true,
    }], 1)).toBe(true);
  });

  it('requires distinct people when two signatures are configured', () => {
    const record = permit({requiredApprovals: ['DISPATCHER', 'ADMIN'], allowAuthorApproval: false});
    const first = {
      role: 'DISPATCHER' as const,
      approvedById: 'reviewer-1',
      permitVersion: 1,
      valid: true,
    };
    expect(isApprovalComplete(record, [first], 1)).toBe(false);
    expect(() => assertCanApprovePermit({
      permit: record,
      actorId: 'reviewer-1',
      role: 'ADMIN',
      approvals: [first],
    })).toThrow(/разными людьми/i);
    expect(assertCanApprovePermit({
      permit: record,
      actorId: 'admin-1',
      role: 'ADMIN',
      approvals: [first],
    })).toBe('ADMIN');
    expect(isApprovalComplete(record, [first, {
      role: 'ADMIN', approvedById: 'admin-1', permitVersion: 1, valid: true,
    }], 1)).toBe(true);
  });

  /*
    Ради чего правило вообще переехало в справочник (решение владельца
    16.08.2026): админ вправе назначить на опасные работы одну подпись
    администратора вместо пары «диспетчер + админ». Раньше такой набор был
    невыразим — состав подписей выводился из риска в коде.
  */
  it('honours an admin-only single-signature rule configured by the owner', () => {
    const record = permit({risk: 'ELEVATED', requiredApprovals: ['ADMIN']});
    expect(() => assertCanApprovePermit({
      permit: record, actorId: 'dispatcher-1', role: 'DISPATCHER', approvals: [],
    })).toThrow(/нет полномочий/i);
    expect(assertCanApprovePermit({
      permit: record, actorId: 'admin-1', role: 'ADMIN', approvals: [],
    })).toBe('ADMIN');
    expect(isApprovalComplete(record, [{
      role: 'ADMIN', approvedById: 'admin-1', permitVersion: 1, valid: true,
    }], 1)).toBe(true);
  });

  /*
    Недонастроенный вид работ (согласующие не заданы) не должен означать
    «подписи не нужны» — иначе наряд согласуется сам собой. Отказ безопаснее.
  */
  it('refuses to approve when no signatures are configured', () => {
    const record = permit({requiredApprovals: []});
    expect(isApprovalComplete(record, [], 1)).toBe(false);
    expect(() => assertCanApprovePermit({
      permit: record, actorId: 'admin-1', role: 'ADMIN', approvals: [],
    })).toThrow(/не заданы согласующие/i);
  });

  // Может ли автор подписать свой наряд — теперь настройка вида работ, а не
  // следствие риска. Обе половины прежнего поведения остались значениями по
  // умолчанию, но их стало видно и можно изменить.
  it('forbids author self-approval only when the work type disallows it', () => {
    const strict = permit({
      authorId: 'author-1', lastEditedById: 'editor-1', allowAuthorApproval: false,
    });
    for (const actorId of ['author-1', 'editor-1']) {
      expect(() => assertCanApprovePermit({
        permit: strict,
        actorId,
        role: 'DISPATCHER',
        approvals: [],
      })).toThrow(/согласует не его автор/i);
    }

    const relaxed = permit({authorId: 'author-1', lastEditedById: 'author-1'});
    expect(assertCanApprovePermit({
      permit: relaxed,
      actorId: 'author-1',
      role: 'DISPATCHER',
      approvals: [],
    })).toBe('DISPATCHER');
  });

  it('invalidates current approvals, resets state and increments version after substantive edit', () => {
    const record = permit({
      state: 'APPROVED',
      approvals: [{
        role: 'DISPATCHER', approvedById: 'dispatcher-1', permitVersion: 1, valid: true,
      }],
    });
    expect(editPermit(record, {scope: 'Работы на площадке 7Б'})).toMatchObject({
      state: 'DRAFT',
      version: 2,
      invalidatesApprovals: true,
      content: {scope: 'Работы на площадке 7Б'},
    });
  });

  /*
    Сторож для полей, добавленных 16.08.2026. Раньше «изменилось ли что-нибудь»
    считалось перечислением полей через ||; забыть там новое поле означало, что
    правка этого поля молча отвечает «нечего сохранять» И оставляет наряд
    согласованным с изменённым содержанием. Смена ответственного и опасных
    факторов — как раз то, ради чего подписи обязаны слетать.
  */
  it('treats responsible-person and hazard edits as substantive', () => {
    const approved = () => permit({
      state: 'APPROVED',
      approvals: [{role: 'DISPATCHER', approvedById: 'dispatcher-1', permitVersion: 1, valid: true}],
    });
    expect(editPermit(approved(), {producerName: 'Кузнецов И.В.'}))
      .toMatchObject({state: 'DRAFT', invalidatesApprovals: true});
    expect(editPermit(approved(), {hazards: ['Открытый огонь']}))
      .toMatchObject({state: 'DRAFT', invalidatesApprovals: true});
    expect(editPermit(approved(), {workTypeId: 'work-type-2'}))
      .toMatchObject({state: 'DRAFT', invalidatesApprovals: true});
  });

  it('rejects no-op edits and terminal-state transitions', () => {
    expect(() => editPermit(permit({state: 'DRAFT'}), {})).toThrow(/нечего сохранять/i);
    expect(() => transitionPermit('REVOKED', 'submit')).toThrow(/сейчас недоступно/i);
  });
});
