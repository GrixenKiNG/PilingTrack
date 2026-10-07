import {describe, expect, it} from 'vitest';
import type {OperatorShiftFacts} from '@/modules/readiness/application/operator-shift-query';
import {resolveV2State, type V2Session} from '../shift-flow';

/**
 * F-QA-005B: сразу после «Закрыть смену и отправить отчёт» смена уходит в
 * CLOSED, и факты с сервера перестают её отдавать — `facts.shift` становится
 * `null`. Проверка «нет смены → приёмка» стояла выше фазы CLOSED, и v2
 * возвращал оператора на «Приёмку установки», будто отчёт не сохранился.
 *
 * Фаза рабочего места переживает закрытие, поэтому именно она решает.
 */
const facts = (overrides: Partial<OperatorShiftFacts> = {}): OperatorShiftFacts => ({
  assignments: [{equipmentId: 'eq-1', equipmentName: 'LRH 100', model: 'LRH', siteId: 'site-1', siteName: 'Площадка'}],
  equipment: {id: 'eq-1', name: 'LRH 100', model: 'LRH', engineHoursTotal: 1240, nextMaintenanceAtHours: 1500},
  shift: null,
  readiness: null,
  inspection: {preShift: null, postShift: null},
  report: {id: 'report-1', status: 'submitted'},
  meterKnownToday: true,
  meterCurrent: 1240,
  meterSource: 'reading',
  meterRecordedAt: '2026-09-27T04:00:00.000Z',
  pilesToday: 12,
  incomingHandover: null,
  startWaiver: null,
  clearance: {blockers: [], warnings: [], documents: []},
  postShiftAvailable: true,
  ...overrides,
});

const session: V2Session = {accepted: true, finishing: true};

describe('resolveV2State — закрытая смена (F-QA-005B)', () => {
  it('нет смены + фаза CLOSED → «Смена закрыта»', () => {
    expect(resolveV2State(facts(), 'CLOSED', true, session)).toEqual({step: 'closed', blockers: []});
  });

  it('нет смены + фаза null → «Приёмка установки»', () => {
    expect(resolveV2State(facts(), null, true, session)).toEqual({step: 'acceptance', blockers: []});
  });

  it('закрытая смена не перекрывается препятствиями допуска', () => {
    const blocked = facts({clearance: {blockers: ['Просрочено удостоверение'], warnings: [], documents: []}});
    expect(resolveV2State(blocked, 'CLOSED', true, session)).toEqual({step: 'closed', blockers: []});
  });
});

describe('resolveV2State — смена после «Завершить работу» ещё не сдана', () => {
  const pending = facts({shift: {id: 'shift-1', state: 'HANDOVER_PENDING'} as unknown as NonNullable<OperatorShiftFacts['shift']>, report: null});

  it('без ЕО после работы — шаг «ЕО после работы», а не «Смена закрыта»', () => {
    expect(resolveV2State(pending, 'CLOSING', false, {accepted: true, finishing: false}).step).toBe('post-inspection');
  });

  it('после ЕО — шаг «Отчёт», смену ещё можно сдать', () => {
    expect(resolveV2State(pending, 'CLOSING', true, {accepted: true, finishing: false}).step).toBe('report');
  });
});
