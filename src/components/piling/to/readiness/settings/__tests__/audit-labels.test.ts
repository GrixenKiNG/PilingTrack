import {describe, expect, it} from 'vitest';
import {auditActionLabel} from '../audit-labels';

/**
 * Коды действий, которые контур техготовности пишет в доказательную цепочку
 * (`recordChainedReadinessAudit`). Список собран грепом по `action:`:
 *
 *   shifts/commands.ts — `shift.*` и `handover.*`;
 *   permits/commands.ts — `work-permit.*`, включая `approved-<роль>`;
 *   defects/commands.ts — `defect.*`;
 *   scheduler.ts — `work-permit.expired`, `shift.auto-closed`;
 *   readiness-rules-service.ts и access-matrix-service.ts — `draft_saved`, `published`;
 *   bootstrap-query.ts — `acting_as_mechanic`;
 *   src/app/api/readiness/export/route.ts — `readiness.exported`.
 *
 * Экран «Аудит» читает ту же цепочку, поэтому сырой код здесь означает сырой
 * код в журнале диспетчера. Новый код контура обязан попасть и в этот список,
 * и в `ACTION_LABEL`.
 */
const CONTOUR_ACTIONS = [
  'shift.created',
  'shift.updated',
  'shift.acceptance-requested',
  'shift.acceptance-declined',
  'shift.started',
  'shift.start-blocked',
  'shift.start-waived',
  'shift.cancelled',
  'shift.auto-closed',
  'handover.submitted',
  'handover.resubmitted',
  'handover.accepted',
  'handover.rework-requested',
  'work-permit.created',
  'work-permit.updated',
  'work-permit.submit',
  'work-permit.approved-dispatcher',
  'work-permit.approved-admin',
  'work-permit.revoke',
  'work-permit.expired',
  'defect.reported',
  'defect.triage',
  'defect.resolve',
  'defect.reject',
  'draft_saved',
  'published',
  'acting_as_mechanic',
  'readiness.exported',
];

describe('auditActionLabel', () => {
  it('labels every action the readiness contour writes to the chain', () => {
    for (const action of CONTOUR_ACTIONS) {
      expect(auditActionLabel(action)).not.toBe(action);
    }
  });

  it('names the scheduler actions, which had no label and showed as raw codes', () => {
    expect(auditActionLabel('work-permit.expired')).toBe('Наряд-допуск истёк');
    expect(auditActionLabel('shift.auto-closed')).toBe('Смена закрыта автоматически');
    expect(auditActionLabel('draft_saved')).toBe('Черновик сохранён');
  });

  it('shows an unknown code as is, so a new action never disappears silently', () => {
    expect(auditActionLabel('shift.unknown-action')).toBe('shift.unknown-action');
  });
});
