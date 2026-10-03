import {describe, expect, it} from 'vitest';
import {auditActionLabel, auditEmptyMessage, auditImportanceLabel} from '../audit-labels';

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

/*
  R125 №2: колонка журнала называлась «Результат» и показывала «Критично/Успешно»,
  смешивая важность с исходом. Записи уже состоялись, поэтому колонка сообщает
  важность: «Критично»/«Обычное».
*/
describe('auditImportanceLabel', () => {
  it('labels a critical action as «Критично»', () => {
    expect(auditImportanceLabel('shift.start-blocked')).toBe('Критично');
    expect(auditImportanceLabel('work-permit.revoke')).toBe('Критично');
  });

  it('labels a non-critical action as «Обычное», not as a made-up outcome', () => {
    expect(auditImportanceLabel('shift.started')).toBe('Обычное');
    expect(auditImportanceLabel('work-permit.expired')).toBe('Обычное');
  });

  it('treats an unknown action as ordinary, matching the criticality check', () => {
    expect(auditImportanceLabel('shift.unknown-action')).toBe('Обычное');
  });
});

/*
  R125 №1: «источник не ответил», «журнал пуст» и «фильтр ничего не нашёл»
  показывали одно «События аудита недоступны в текущем источнике», и диспетчер
  жал «Повторить» вместо сброса фильтра.
*/
describe('auditEmptyMessage', () => {
  it('names an unreachable source, not an empty journal', () => {
    expect(auditEmptyMessage(false, 0, 0)).toBe('События аудита недоступны в текущем источнике.');
  });

  it('says the journal has no events yet when the source answered without filters', () => {
    expect(auditEmptyMessage(true, 0, 0)).toBe('В журнале пока нет событий.');
  });

  it('blames the active filter, not the source, when a filter matched nothing', () => {
    expect(auditEmptyMessage(true, 1, 0)).toBe('По фильтру ничего не найдено.');
  });

  it('blames the search query when events were loaded but the query hid them', () => {
    expect(auditEmptyMessage(true, 0, 5)).toBe('По запросу ничего не найдено.');
  });
});
