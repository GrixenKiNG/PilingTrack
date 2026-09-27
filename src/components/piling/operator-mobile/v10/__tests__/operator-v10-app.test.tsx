import {describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import type {ChecklistView, OperatorMobileState} from '@/modules/operator-mobile/contracts';
// Экран тянет рабочий обзор оператора, а тот — свои стили; в тесте они не нужны.
vi.mock('../../operator-concept.css', () => ({}));
import {gapsBySection, gapsNote, ppeOutcome, downtimeWindowProblem, ScreenClosing} from '../operator-v10-app';

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

/**
 * D-20260927-004: окно смены проверял только сервер, и отказ «Простой не может
 * начаться раньше смены…» приходил уже после «Записать». Границы обязаны быть
 * видны до отправки, а текст — тот же, что у сервера.
 */
describe('окно простоя до отправки', () => {
  const now = new Date(2026, 8, 27, 5, 30, 0);
  const shiftStartedAt = new Date(2026, 8, 27, 4, 44, 0).toISOString();

  it('называет начало смены, когда простой начинается раньше', () => {
    expect(downtimeWindowProblem('03:00', '05:30', shiftStartedAt, now))
      .toBe('Простой не может начаться раньше смены — смена начата в 04:44.');
  });

  it('пропускает простой в окне смены', () => {
    expect(downtimeWindowProblem('04:50', '05:30', shiftStartedAt, now)).toBeNull();
  });

  it('не придирается к расхождению часов в пять минут', () => {
    expect(downtimeWindowProblem('04:40', '05:30', shiftStartedAt, now)).toBeNull();
  });

  it('молчит, пока смены нет или поля пусты', () => {
    expect(downtimeWindowProblem('03:00', '05:30', null, now)).toBeNull();
    expect(downtimeWindowProblem('', '', shiftStartedAt, now)).toBeNull();
  });
});

/**
 * F-R43-1: смену нельзя закрыть, пока на телефоне лежат неотправленные записи.
 *
 * Закрытая смена отвечает отложенной выработке 409 «Смена уже закрыта»
 * (`modules/operator-mobile/.../shared.ts`), и в отчёт она не попадает. Экран
 * обязан держать кнопку закрытия и отправлять очередь по нажатию.
 */
describe('закрытие смены при непустой очереди', () => {
  const ready = {
    phase: 'CLOSING',
    assignment: null,
    receipt: null,
    defects: [],
    entries: [],
    checklists: [{stage: 'EO_AFTER', done: true}],
  } as unknown as OperatorMobileState;

  it('держит закрытие и предлагает отправить записи', () => {
    const onClose = vi.fn();
    const onFlush = vi.fn();
    render(
      <ScreenClosing state={ready} busy={false} onClose={onClose} go={() => {}}
        unsent={2} onFlush={onFlush} />,
    );

    expect(screen.getByText('Сначала отправьте записи с телефона: 2 не отправлено')).toBeInTheDocument();
    const close = screen.getByRole('button', {name: 'Закрыть смену'});
    expect(close).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: 'Отправить сейчас'}));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста', () => {
    const onClose = vi.fn();
    render(
      <ScreenClosing state={ready} busy={false} onClose={onClose} go={() => {}}
        unsent={0} onFlush={() => {}} />,
    );

    expect(screen.queryByText(/Сначала отправьте записи/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену'}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
