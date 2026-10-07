import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {ChecklistView} from '@/modules/operator-mobile/contracts';
import {ChecklistScreen} from './checklist-screen';

const checklist: ChecklistView = {
  stage: 'PRESHIFT_INSPECTION',
  title: 'Предсменный осмотр',
  purpose: 'Проверка перед работой',
  version: 'test-1',
  done: false,
  period: null,
  sections: [{
    id: 'cab',
    title: 'Кабина',
    items: [{id: 'glass', text: 'Стёкла и зеркала', severity: 'NOTE'}],
  }],
};

describe('чек-лист машиниста', () => {
  it.each([true, false])('передаёт отметку замены счётчика только при явном выборе: %s', (replacement) => {
    const onSubmit = vi.fn();
    render(<ChecklistScreen checklist={{...checklist, sections: [{id: 'meter', title: 'Счётчик', items: [
      {id: 'hours', text: 'Снять показание', severity: 'NOTE', measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'}},
    ]}]}} warnings={[]} onSubmit={onSubmit} busy={false} error={null} commandId="meter-test"
      lastMeter={{engineHours: 3000, recordedAt: '2026-10-06T15:00:00.000Z'}} />);
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '99'}});
    const checkbox = screen.getByRole('checkbox', {name: 'Счётчик заменён'});
    expect(checkbox).not.toBeChecked();
    if (replacement) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({
      itemId: 'hours', answer: 'OK', measures: {engineHours: 99},
      note: replacement ? 'Счётчик заменён' : undefined,
    })]);
  });
  it('позволяет проверить пробелы и называет первый незаполненный пункт', () => {
    const props = {
      warnings: [],
      onSubmit: vi.fn(),
      busy: false,
      error: null,
      commandId: 'test-command',
    };
    const view = render(
      <ChecklistScreen
        key={checklist.stage}
        checklist={checklist}
        {...props}
      />,
    );

    const check = screen.getByRole('button', {name: /Осталось заполнить: 1/});
    expect(check).toBeEnabled();
    fireEvent.click(check);
    expect(screen.getByRole('alert')).toHaveTextContent('Стёкла и зеркала');

    view.rerender(
      <ChecklistScreen
        key="EO_BEFORE"
        checklist={{
          ...checklist,
          stage: 'EO_BEFORE',
          title: 'ЕО перед работой',
          sections: [{
            id: 'engine',
            title: 'Двигатель',
            items: [{id: 'oil', text: 'Уровень масла', severity: 'NOTE'}],
          }],
        }}
        {...props}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Отмечено 0 из 1')).toBeInTheDocument();
  });

  // Смысл кнопки «весь раздел в норме» держится на одном исключении: она не
  // отвечает за пункты, где неисправность обязана быть подтверждена снимком,
  // и за пункты с замером. Без этого она превращается в ту самую кнопку
  // «подтвердить всё», которую пришлось убирать из v10.
  it('не отвечает разделом за пункт со снимком и за пункт с замером', () => {
    const onSubmit = vi.fn();
    render(
      <ChecklistScreen
        checklist={{
          ...checklist,
          sections: [{
            id: 'mast',
            title: 'Мачта',
            items: [
              {id: 'plain-a', text: 'Ограждения на месте', severity: 'NOTE'},
              {id: 'plain-b', text: 'Таблички читаются', severity: 'NOTE'},
              {id: 'welds', text: 'Швы мачты без трещин', severity: 'ALERT', photoOnIssue: true},
              {
                id: 'hours',
                text: 'Показание счётчика снято',
                severity: 'NOTE',
                measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
              },
            ],
          }]}
        }
        warnings={[]}
        onSubmit={onSubmit}
        busy={false}
        error={null}
        commandId="test-command"
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Весь раздел «Мачта» в норме'}));

    // Закрыты только два обычных пункта, снимок и замер остались на человеке.
    expect(screen.getByText('Отмечено 2 из 4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /Осталось заполнить: 2/}));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Ответ, который дала система, обязан уходить с основанием: иначе через
  // полгода нельзя отличить подтверждённое человеком от вычисленного.
  it('отправляет системный ответ с основанием и не спрашивает его у человека', () => {
    const onSubmit = vi.fn();
    render(
      <ChecklistScreen
        checklist={{
          ...checklist,
          sections: [{
            id: 'people',
            title: 'Люди',
            items: [{id: 'wind', text: 'Ветер в допуске для подъёма сваи', severity: 'ALERT'}],
          }]}
        }
        warnings={[]}
        onSubmit={onSubmit}
        busy={false}
        error={null}
        commandId="test-command"
        known={{wind: {fact: 'Ветер 7,3 м/с при пороге 15 м/с'}}}
      />,
    );

    // Раздел свёрнут — раскрываем, чтобы увидеть, чем заменён вопрос.
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    expect(screen.queryByRole('button', {name: 'Норма'})).not.toBeInTheDocument();
    expect(screen.getByText(/Ветер 7,3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({
        itemId: 'wind',
        answer: 'OK',
        note: 'Подтверждено системой: Ветер 7,3 м/с при пороге 15 м/с',
      }),
    ]);
  });
});
