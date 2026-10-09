import {describe, expect, it} from 'vitest';
import type {ReadinessShiftDto} from '../../api/contracts';
import {buildShiftNextAction} from '../shift-next-action';

const shift = (state: ReadinessShiftDto['state'], id = `s-${state}`) =>
  ({id, equipmentId: 'eq-1', state} as ReadinessShiftDto);
const caps = {manage: true, decide: true, prepare: true};
const run = (shifts: ReadinessShiftDto[], overrides: Partial<Parameters<typeof buildShiftNextAction>[0]> = {}) =>
  buildShiftNextAction({equipmentName: 'КБУРГ-16.02 №2', shifts, inspectionDone: false, caps, ...overrides});

describe('следующее действие по выбранной установке на вкладке «Смены»', () => {
  it('нет смены на сегодня: объясняет, почему осмотра и приёмки нет, и предлагает создать смену', () => {
    const next = run([]);
    expect(next.title).toContain('КБУРГ-16.02 №2');
    expect(next.title).toContain('нет смены');
    expect(next.text).toContain('по смене');
    expect(next.button).toEqual({label: 'Создать смену', kind: 'create'});
  });

  it('нет смены и нет права создавать: называет, кто создаёт, без кнопки', () => {
    const next = run([], {caps: {...caps, manage: false}});
    expect(next.button).toBeUndefined();
    expect(next.text).toContain('оператор или администратор');
  });

  it('смена запланирована: запросить допуск', () => {
    expect(run([shift('PLANNED')]).button).toEqual({label: 'Запросить допуск', kind: 'command', action: 'request-acceptance', shiftId: 's-PLANNED'});
  });

  it('смена ждёт допуска, осмотра нет: говорит, где пройти осмотр, и всё равно даёт «Допустить»', () => {
    const next = run([shift('PENDING_ACCEPTANCE')]);
    expect(next.text).toContain('экране машиниста');
    expect(next.button).toMatchObject({label: 'Допустить', kind: 'command', action: 'start'});
  });

  it('смена ждёт допуска, осмотр пройден: допуск без оговорок про осмотр', () => {
    const next = run([shift('PENDING_ACCEPTANCE')], {inspectionDone: true});
    expect(next.text).not.toContain('экране машиниста');
    expect(next.button).toMatchObject({action: 'start'});
  });

  it('без права решать допуск кнопки нет, но названо, кто решает', () => {
    const next = run([shift('PENDING_ACCEPTANCE')], {caps: {...caps, decide: false}});
    expect(next.button).toBeUndefined();
    expect(next.text).toContain('диспетчер');
  });

  it('смена идёт: передать', () => {
    expect(run([shift('STARTED')]).button).toMatchObject({label: 'Передать', action: 'handover'});
  });

  it('все смены закрыты: цикл закрыт, можно создать новую', () => {
    const next = run([shift('CLOSED')]);
    expect(next.title).toContain('закрыта');
    expect(next.button).toEqual({label: 'Создать смену', kind: 'create'});
  });

  it('при нескольких сменах берёт самую «живую»: ожидающую допуска раньше закрытой', () => {
    expect(run([shift('CLOSED'), shift('PENDING_ACCEPTANCE')]).button).toMatchObject({action: 'start'});
  });
});
