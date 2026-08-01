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
  risk: 'NORMAL',
  state: 'PENDING_APPROVAL',
  scope: 'Работы на площадке 7А',
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

  it('approves NORMAL with one non-author dispatcher', () => {
    const record = permit();
    expect(assertCanApprovePermit({
      permit: record,
      actorId: 'dispatcher-1',
      role: 'DISPATCHER',
      approvals: [],
    })).toBe('DISPATCHER');
    expect(isApprovalComplete('NORMAL', [{
      role: 'DISPATCHER', approvedById: 'dispatcher-1', permitVersion: 1, valid: true,
    }], 1)).toBe(true);
  });

  it('requires distinct dispatcher and admin users for ELEVATED', () => {
    const record = permit({risk: 'ELEVATED'});
    const first = {
      role: 'DISPATCHER' as const,
      approvedById: 'reviewer-1',
      permitVersion: 1,
      valid: true,
    };
    expect(isApprovalComplete('ELEVATED', [first], 1)).toBe(false);
    expect(() => assertCanApprovePermit({
      permit: record,
      actorId: 'reviewer-1',
      role: 'ADMIN',
      approvals: [first],
    })).toThrow(/distinct users/i);
    expect(assertCanApprovePermit({
      permit: record,
      actorId: 'admin-1',
      role: 'ADMIN',
      approvals: [first],
    })).toBe('ADMIN');
    expect(isApprovalComplete('ELEVATED', [first, {
      role: 'ADMIN', approvedById: 'admin-1', permitVersion: 1, valid: true,
    }], 1)).toBe(true);
  });

  it('forbids author and last editor self-approval', () => {
    const record = permit({authorId: 'author-1', lastEditedById: 'editor-1'});
    for (const actorId of ['author-1', 'editor-1']) {
      expect(() => assertCanApprovePermit({
        permit: record,
        actorId,
        role: 'DISPATCHER',
        approvals: [],
      })).toThrow(/self-approve/i);
    }
  });

  it('invalidates current approvals, resets state and increments version after substantive edit', () => {
    const record = permit({
      state: 'APPROVED',
      approvals: [{
        role: 'DISPATCHER', approvedById: 'dispatcher-1', permitVersion: 1, valid: true,
      }],
    });
    expect(editPermit(record, {scope: 'Работы на площадке 7Б'}, 'mechanic-2')).toMatchObject({
      state: 'DRAFT',
      version: 2,
      invalidatesApprovals: true,
      content: {scope: 'Работы на площадке 7Б'},
    });
  });

  it('rejects no-op edits and terminal-state transitions', () => {
    expect(() => editPermit(permit({state: 'DRAFT'}), {}, 'mechanic-2')).toThrow(/no substantive change/i);
    expect(() => transitionPermit('REVOKED', 'submit')).toThrow(/cannot execute/i);
  });
});
