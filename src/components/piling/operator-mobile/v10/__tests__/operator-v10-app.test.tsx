import {describe, expect, it, vi} from 'vitest';
import type {ChecklistView, OperatorMobileState} from '@/modules/operator-mobile/contracts';
// Экран тянет рабочий обзор оператора, а тот — свои стили; в тесте они не нужны.
vi.mock('../../operator-concept.css', () => ({}));
import {gapsBySection, gapsNote, ppeOutcome} from '../operator-v10-app';

/**
 * Ошибка чек-листа обязана называть раздел.
 *
 * Сервер отвечает общей строкой «Чек-лист заполнен не полностью», и по ней
 * не видно, какой из блоков незаполнен (D-20260927-002). Отдельно проверяем
 * замер: на ЕО после работы отказ приходил из-за незаполненных моточасов и
 * остатка топлива, а ответы «норма» уже стояли.
 */
const list: ChecklistView = {
  stage: 'EO_AFTER',
  title: 'ЕО после работы',
  purpose: 'Осмотр после смены',
  version: 'test-1',
  done: false,
  period: null,
  sections: [
    {
      id: 'park',
      title: 'Постановка',
      items: [{id: 'park-1', text: 'Мачта опущена на землю', severity: 'NOTE'}],
    },
    {
      id: 'fuel',
      title: 'Заправка и заглушение',
      items: [
        {id: 'fuel-1', text: 'Двигатель заглушен', severity: 'NOTE'},
        {id: 'fuel-2', text: 'Кабина закрыта', severity: 'NOTE'},
      ],
    },
  ],
};

describe('незаполненные пункты чек-листа', () => {
  it('называет раздел и число незакрытых пунктов', () => {
    const gaps = gapsBySection(list, {}, {});
    expect(gapsNote(gaps)).toBe('Не заполнено: «Постановка» — 1 пункт; «Заправка и заглушение» — 2 пункта');
  });

  it('считает незаполненный обязательный замер незакрытым пунктом', () => {
    const measured: ChecklistView = {
      ...list,
      sections: [{
        id: 'counters',
        title: 'Заправка и заглушение',
        items: [
          {
            id: 'hours',
            text: 'Моточасы на конец смены сняты',
            severity: 'NOTE',
            measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
          },
          {
            id: 'fuel-left',
            text: 'Остаток топлива снят с указателя',
            severity: 'NOTE',
            measure: {key: 'fuelPercent', label: 'Остаток топлива', unit: '%', min: 0, max: 100},
          },
        ],
      }],
    };

    const empty = gapsBySection(measured, {hours: 'OK', 'fuel-left': 'OK'}, {});
    expect(gapsNote(empty)).toBe('Не заполнено: «Заправка и заглушение» — 2 пункта');

    // Заполненный замер пункт закрывает.
    const filled = gapsBySection(measured, {hours: 'OK', 'fuel-left': 'OK'}, {engineHours: '1240', fuelPercent: '55'});
    expect(filled).toEqual([]);
  });
});

/**
 * D-20260927-003: подтверждение СИЗ не заканчивало допуск на экране.
 *
 * «СИЗ подтверждены» уходило во всплывающую строку и пропадало, кнопки
 * продолжения не было — уйти можно было только догадавшись нажать вкладку
 * снизу. Экран обязан назвать итог и дать «Далее».
 */
function identity(patch: {
  phase?: string;
  ppe?: {confirmed: boolean; missing?: string[]};
  briefing?: {ok: boolean; acknowledgedAt?: string | null};
  knowledge?: {ok: boolean};
} = {}) {
  return {
    phase: patch.phase ?? 'IDENTITY',
    productionDate: '2026-09-27',
    identity: {
      ppe: {confirmed: true, missing: [], ...patch.ppe},
      briefing: {ok: false, acknowledgedAt: null, ...patch.briefing},
      knowledge: {ok: false, ...patch.knowledge},
    },
  } as unknown as OperatorMobileState;
}

describe('итог подтверждения СИЗ', () => {
  it('объявляет подтверждение и ведёт к следующему шагу допуска', () => {
    expect(ppeOutcome(identity())).toEqual({
      title: 'СИЗ подтверждены',
      note: 'Дальше: Ознакомление с инструкциями',
      screen: 'briefing',
    });
  });

  it('ведёт к проверке знаний, когда инструкция уже прочитана', () => {
    const ready = ppeOutcome(identity({briefing: {ok: true, acknowledgedAt: '2026-09-27T04:00:00.000Z'}}));
    expect(ready.title).toBe('СИЗ подтверждены');
    expect(ready.screen).toBe('knowledge');
  });

  it('объявляет допуск и ведёт к приёмке установки, когда все шаги пройдены', () => {
    const admitted = identity({
      phase: 'ADMISSION',
      briefing: {ok: true, acknowledgedAt: '2026-09-27T04:00:00.000Z'},
      knowledge: {ok: true},
    });
    expect(ppeOutcome(admitted)).toEqual({
      title: 'Вы допущены к смене',
      note: 'Допуск пройден',
      screen: 'accept',
    });
  });

  it('не объявляет допуск, пока его держит сервер', () => {
    const waiting = identity({briefing: {ok: true, acknowledgedAt: '2026-09-27T04:00:00.000Z'}, knowledge: {ok: true}});
    expect(ppeOutcome(waiting)).toEqual({
      title: 'СИЗ подтверждены',
      note: 'Все шаги допуска пройдены',
      screen: 'safety',
    });
  });
});
