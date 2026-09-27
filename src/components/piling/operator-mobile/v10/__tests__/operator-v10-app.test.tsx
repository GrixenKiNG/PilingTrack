import {describe, expect, it, vi} from 'vitest';
import type {ChecklistView} from '@/modules/operator-mobile/contracts';
// Экран тянет рабочий обзор оператора, а тот — свои стили; в тесте они не нужны.
vi.mock('../../operator-concept.css', () => ({}));
import {gapsBySection, gapsNote} from '../operator-v10-app';

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
