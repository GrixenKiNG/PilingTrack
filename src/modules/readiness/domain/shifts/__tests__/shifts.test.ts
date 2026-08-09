import {describe, expect, it} from 'vitest';
import {requireReworkReason, validateHandoverSummary} from '../handover';
import {requireCancellationReason, validateShiftWindow} from '../shift';
import {tenantProductionDate} from '../tenant-production-date';
import {transitionHandover, transitionShift} from '../transitions';

describe('shift and handover domain', () => {
  it.each([
    ['PLANNED', 'request', 'PENDING_ACCEPTANCE'],
    ['PENDING_ACCEPTANCE', 'start', 'STARTED'],
    ['PENDING_ACCEPTANCE', 'decline', 'PLANNED'],
    ['STARTED', 'handover', 'HANDOVER_PENDING'],
    ['HANDOVER_PENDING', 'accept', 'CLOSED'],
    ['PLANNED', 'cancel', 'CANCELLED'],
    ['PENDING_ACCEPTANCE', 'cancel', 'CANCELLED'],
    ['STARTED', 'cancel', 'CANCELLED'],
    ['HANDOVER_PENDING', 'rework', 'STARTED'],
  ] as const)('moves shift %s --%s--> %s', (state, command, expected) => {
    expect(transitionShift(state, command)).toBe(expected);
  });

  it.each([
    ['DRAFT', 'submit', 'SUBMITTED'],
    ['REWORK_REQUIRED', 'submit', 'SUBMITTED'],
    ['SUBMITTED', 'accept', 'ACCEPTED'],
    ['SUBMITTED', 'rework', 'REWORK_REQUIRED'],
  ] as const)('moves handover %s --%s--> %s', (state, command, expected) => {
    expect(transitionHandover(state, command)).toBe(expected);
  });

  it('keeps terminal states and forbidden cancellation closed', () => {
    expect(() => transitionHandover('ACCEPTED', 'rework')).toThrow(/сейчас недоступно/i);
    expect(() => transitionShift('HANDOVER_PENDING', 'cancel')).toThrow(/сейчас недоступно/i);
    // Допуск нельзя обойти: прямой запуск из PLANNED должен оставаться закрытым.
    expect(() => transitionShift('PLANNED', 'start')).toThrow(/сейчас недоступно/i);
    expect(() => transitionShift('CLOSED', 'start')).toThrow(/сейчас недоступно/i);
  });

  it('derives production date only from server instant and tenant timezone', () => {
    const instant = new Date('2026-08-01T21:30:00.000Z');
    expect(tenantProductionDate(instant, 'Europe/Moscow').toISOString()).toBe('2026-08-02T00:00:00.000Z');
    expect(tenantProductionDate(instant, 'UTC').toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(tenantProductionDate(instant, 'invalid/timezone').toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('validates windows, summaries and required reasons', () => {
    expect(() => validateShiftWindow(new Date('2026-08-02'), new Date('2026-08-01'))).toThrow(/должно быть позже|должна быть позже/i);
    expect(validateHandoverSummary('  Смена передана  ')).toBe('Смена передана');
    expect(requireCancellationReason('  Поломка  ')).toBe('Поломка');
    expect(requireReworkReason('  Уточнить дефект  ')).toBe('Уточнить дефект');
  });
});
