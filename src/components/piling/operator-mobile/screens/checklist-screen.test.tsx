import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('../api', async (importOriginal) => ({...(await importOriginal<typeof import('../api')>()), uploadPhoto: vi.fn().mockResolvedValue('photo-1')}));
import type {ChecklistView} from '@/modules/operator-mobile';
import {ChecklistScreen} from './checklist-screen';
import {uploadPhoto} from '../api';
beforeEach(() => window.localStorage.clear());

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
  it('не сохраняет пустой лист после снятия групповой отметки', () => {
    render(<ChecklistScreen checklist={checklist} warnings={[]} busy={false} error={null} commandId="command"
      draftUserId="operator" draftShiftId="shift" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    const all = screen.getByRole('button', {name: 'Весь раздел «Кабина» в норме'});
    fireEvent.click(all);
    fireEvent.click(all);
    expect(Object.keys(window.localStorage).filter((key) => key.startsWith('pilingtrack:form-draft:'))).toEqual([]);
  });
  it('восстанавливает ответ и фото с исходным ключом команды; принятый черновик удаляет', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const props = {checklist: {...checklist, sections: [{id: 'cab', title: 'Кабина', items: [
      {id: 'glass', text: 'Стёкла и зеркала', severity: 'ALERT' as const, photoOnIssue: true},
    ]}]}, warnings: [], busy: false, error: null, draftUserId: 'operator', draftShiftId: 'shift', onSubmit};
    const view = render(<ChecklistScreen {...props} commandId="original-command" />);
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    fireEvent.click(screen.getByRole('button', {name: 'Замечание'}));
    fireEvent.change(screen.getByRole('textbox'), {target: {value: 'Трещина стекла'}});
    const photo = view.container.querySelector('input[type="file"]');
    if (!photo) throw new Error('Нет поля фотографии');
    fireEvent.change(photo, {target: {files: [new File(['qa'], 'qa.jpg', {type: 'image/jpeg'})]}});
    await screen.findByRole('button', {name: 'Снимков: 1. Добавить ещё'});
    expect(uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({clientCommandId: 'original-command'}));
    view.unmount();
    const restored = render(<ChecklistScreen {...props} commandId="new-command" />);
    expect(screen.getByText('Отмечено 1 из 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({answer: 'REMARK', note: 'Трещина стекла', mediaIds: ['photo-1']}),
    ], 'original-command'));
    await waitFor(() => expect(screen.getByText('Отмечено 0 из 1')).toBeInTheDocument());
    restored.unmount();
    render(<ChecklistScreen {...props} commandId="third-command" />);
    expect(screen.getByText('Отмечено 0 из 1')).toBeInTheDocument();
  });
  it('объясняет, что снимок нужен при замечании или отказе, и принимает норму без снимка', () => {
    const onSubmit = vi.fn();
    render(<ChecklistScreen checklist={{...checklist, sections: [{
      id: 'mast', title: 'Мачта', items: [{id: 'welds', text: 'Швы мачты', severity: 'ALERT', photoOnIssue: true}],
    }]}} warnings={[]} busy={false} error={null} commandId="test-command" onSubmit={onSubmit} />);
    expect(screen.getByText('Проверьте каждый пункт: фото при замечании или отказе, замеры')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    expect(screen.queryByRole('button', {name: 'Снять фото'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({answer: 'OK', mediaIds: undefined})]);
  });
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

/**
 * «Долил за смену» (16.10.2026): четыре необязательных поля в литрах в разделе
 * «Заправка и заглушение», без кнопок «норма / замечание / отказ».
 */
describe('чек-лист машиниста: блок «Долил за смену»', () => {
  const topUp = (id: string, text: string, key: string) => ({
    id, text, severity: 'NOTE' as const, topUp: true,
    measure: {key, label: text, unit: 'л', min: 0, max: 2000},
  });
  const eoAfter: ChecklistView = {
    ...checklist,
    stage: 'EO_AFTER',
    title: 'ЕО после работы',
    sections: [{
      id: 'closing',
      title: 'Заправка и заглушение',
      items: [
        {id: 'shutdown-1', text: 'Двигатель заглушен', severity: 'ALERT'},
        topUp('topup-coolant', 'Антифриз', 'coolantL'),
        topUp('topup-hydraulic', 'Гидравлическое масло', 'hydraulicOilL'),
        topUp('topup-engine-oil', 'Моторное масло', 'engineOilL'),
        topUp('topup-diesel', 'Дизельное топливо', 'dieselL'),
      ],
    }],
  };
  const renderEo = (onSubmit = vi.fn()) => {
    render(<ChecklistScreen checklist={eoAfter} warnings={[]} busy={false} error={null} commandId="topup-test" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', {expanded: false}));
    return onSubmit;
  };

  it('рисует один блок с четырьмя полями в литрах, а кнопки вердикта только у обычного пункта', () => {
    renderEo();
    expect(screen.getByText('Долил за смену')).toBeInTheDocument();
    expect(screen.getByText('Если не доливали, оставьте пустым')).toBeInTheDocument();
    for (const name of ['Антифриз', 'Гидравлическое масло', 'Моторное масло', 'Дизельное топливо']) {
      expect(screen.getByRole('spinbutton', {name: `${name}, л`})).toHaveValue(null);
    }
    expect(screen.getAllByRole('button', {name: 'Норма'})).toHaveLength(1);
  });

  it('не считает доливы обязательными: счётчик и кнопка «Завершить» ждут только обычный пункт', () => {
    renderEo();
    expect(screen.getByText('Отмечено 0 из 1')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Осталось заполнить: 1'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    expect(screen.getByText('Отмечено 1 из 1')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Завершить'})).toBeInTheDocument();
  });

  it('без долива отправляет только обязательный ответ: пусто — не доливал', () => {
    const onSubmit = renderEo();
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual([expect.objectContaining({itemId: 'shutdown-1', answer: 'OK'})]);
  });

  it('отправляет заполненные литры ответом «OK» с замером, а пустые поля пропускает', () => {
    const onSubmit = renderEo();
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Дизельное топливо, л'}), {target: {value: '120'}});
    fireEvent.change(screen.getByRole('spinbutton', {name: 'Моторное масло, л'}), {target: {value: '2.5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    const sent = onSubmit.mock.calls[0]?.[0] as Array<{itemId: string; answer: string; measures?: Record<string, number>}>;
    expect(sent.map((answer) => answer.itemId).sort()).toEqual(['shutdown-1', 'topup-diesel', 'topup-engine-oil']);
    expect(sent.find((answer) => answer.itemId === 'topup-diesel')).toMatchObject({answer: 'OK', measures: {dieselL: 120}});
    expect(sent.find((answer) => answer.itemId === 'topup-engine-oil')?.measures).toEqual({engineOilL: 2.5});
  });

  it('раздел считается закрытым по обязательным пунктам, а прогресс раздела их же и показывает', () => {
    renderEo();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });
});
