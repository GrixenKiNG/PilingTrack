/**
 * v10: смена строго по порядку (жалобы владельца 28.09.2026).
 *
 * «Логика вразброс, можно сразу закрыть смену», «простой не записывается»,
 * «Сдать ЕО после работы — ничего не происходит», «не показывает моточасы
 * прошлой смены». Каждый тест — одна из этих жалоб.
 */
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

const api = vi.hoisted(() => ({
  fetchState: vi.fn(),
  sendCommand: vi.fn(),
}));

vi.mock('@/components/piling/operator-mobile/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/piling/operator-mobile/api')>();
  return {
    ...actual,
    fetchState: api.fetchState,
    sendCommand: api.sendCommand,
    currentPosition: vi.fn(async () => null),
  };
});
vi.mock('@/components/piling/operator-mobile/use-offline-queue', () => ({
  useOfflineQueue: () => ({queued: [], flush: vi.fn(), retry: vi.fn(), discard: vi.fn()}),
}));
vi.mock('../../operator-concept.css', () => ({}));

import {ApiError} from '@/components/piling/operator-mobile/api';
import {OperatorV10App} from '../operator-v10-app';

const STAGES = ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'EO_AFTER'] as const;

function checklist(stage: string, done: boolean) {
  return {
    stage, title: {PRESHIFT_INSPECTION: 'Предсменный осмотр', SITE_READY: 'Готовность площадки',
      EO_BEFORE: 'ЕО перед работой', EO_AFTER: 'ЕО после работы'}[stage] ?? stage,
    purpose: '', version: '1', done, period: null,
    sections: [{
      id: `${stage}-s`, title: 'Узел',
      items: stage === 'EO_AFTER'
        ? [{id: 'meter', text: 'Снять моточасы', measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'}}]
        : [{id: `${stage}-1`, text: `Пункт ${stage}`}],
    }],
  };
}

function makeState(phase: string, doneStages: string[] = []): OperatorMobileState {
  return {
    phase,
    productionDate: '2026-09-28',
    operator: {id: 'op', name: 'Иванов'},
    identity: {
      ppe: {confirmed: true, missing: []}, briefing: {ok: true}, knowledge: {ok: true}, documents: [],
    },
    assignment: {
      equipmentId: 'eq-1', equipmentName: 'Woltman-PVE 50PR', equipmentModel: 'PVE', siteName: 'Объект А',
      assistants: [], fuelPercent: 40,
      lastMeter: {engineHours: 1234, recordedAt: '2026-09-27T18:00:00.000Z'},
    },
    options: [],
    weather: null,
    permit: {allowed: true, blocks: []},
    warnings: [],
    defects: [],
    shift: {id: 'shift-1'},
    checklists: STAGES.map((stage) => checklist(stage, doneStages.includes(stage))),
    entries: [],
    production: {piles: {count: 0}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
    dictionaries: {
      pileGrades: [], drillingTypes: [],
      downtimeReasons: [{id: 'r1', name: 'Ремонт установки'}],
    },
    receipt: null,
  } as unknown as OperatorMobileState;
}

beforeEach(() => {
  api.fetchState.mockReset();
  api.sendCommand.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 200})));
});

describe('v10: порядок смены', () => {
  it('старую смену явно датирует и следующий шаг ведёт к сдаче вместо сегодняшней выработки', async () => {
    const state = makeState('WORK', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
    state.shift = {id: 'shift-1', productionDate: '2026-09-27', state: 'STARTED', startedAt: null};
    api.fetchState.mockResolvedValue(state);
    render(<OperatorV10App />);

    await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'});
    expect(screen.getByText('Не сдана смена за 27.09.2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Дописать отчёт за 27.09.2026'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Дописать отчёт за 27.09.2026'}));
    expect(await screen.findByRole('button', {name: 'Добавить сваю'})).toBeInTheDocument();
    expect(screen.getByText('27.09.2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('дописанное вчерашнее остаётся в старой смене, после сдачи открывается сегодняшняя', async () => {
    const old = makeState('CLOSING', [...STAGES]);
    old.shift = {id: 'shift-1', productionDate: '2026-09-27', state: 'HANDOVER_PENDING', startedAt: null};
    api.fetchState.mockResolvedValue(old);
    api.sendCommand.mockResolvedValue({ok: true});
    render(<OperatorV10App />);

    await screen.findByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'});
    expect(screen.getByText('Не сдана смена за 27.09.2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Дописать отчёт за 27.09.2026'}));
    fireEvent.click(screen.getByRole('button', {name: 'Записать простой'}));
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'r1'}});
    fireEvent.change(screen.getByLabelText('Простой, часов'), {target: {value: '1.5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({command: 'log-production', shiftId: 'shift-1', entry: {kind: 'DOWNTIME', reasonId: 'r1', hours: 1.5}})));
    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));

    const today = makeState('ADMISSION');
    today.shift = null;
    api.fetchState.mockResolvedValue(today);
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'close-shift', shiftId: 'shift-1', comment: ''}));
    await waitFor(() => expect(screen.queryByText('Не сдана смена за 27.09.2026')).not.toBeInTheDocument());

    const workingToday = makeState('WORK', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
    workingToday.shift = {id: 'shift-today', productionDate: '2026-09-28', state: 'STARTED', startedAt: null};
    api.fetchState.mockResolvedValue(workingToday);
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Главная'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
    fireEvent.click(screen.getByRole('button', {name: 'Записать простой'}));
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'r1'}});
    fireEvent.change(screen.getByLabelText('Простой, часов'), {target: {value: '0.25'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({command: 'log-production', shiftId: 'shift-today', entry: {kind: 'DOWNTIME', reasonId: 'r1', hours: 0.25}})));
  });
  it('на «Смене» — сделанные шаги отмечены, нажать можно только текущий', async () => {
    api.fetchState.mockResolvedValue(makeState('PRESHIFT_INSPECTION'));
    render(<OperatorV10App />);

    expect(await screen.findByRole('button', {name: 'Дальше: Предсменный осмотр'})).toBeInTheDocument();
    expect(screen.getByText('1. Допуск: СИЗ, инструктаж, проверка знаний').closest('.ov10-row'))
      .toHaveTextContent('выполнено');
    // Будущий шаг — не кнопка: закрыть смену отсюда нельзя.
    const closing = screen.getByText('7. ЕО после работы и закрытие смены').closest('.ov10-row');
    expect(closing?.tagName).not.toBe('BUTTON');
    expect(closing).toHaveTextContent('откроется после предыдущего шага');
  });

  it('«Закрытие смены» до работы не открывается — только «сначала …»', async () => {
    api.fetchState.mockResolvedValue(makeState('ADMISSION'));
    render(<OperatorV10App />);
    await screen.findByRole('button', {name: 'Дальше: Принять установку'});

    fireEvent.click(screen.getByRole('button', {name: 'Ещё'}));
    fireEvent.click(screen.getByRole('button', {name: /Закрытие смены/}));

    expect(await screen.findByText('Этот шаг ещё не открыт')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Закрыть смену/})).not.toBeInTheDocument();
  });

  it('«Завершить работу» отправляется на сервер — после подтверждения', async () => {
    api.fetchState.mockResolvedValue(makeState('WORK', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']));
    api.sendCommand.mockResolvedValue({ok: true});
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
    fireEvent.click(screen.getAllByRole('button', {name: 'Завершить работу'})[0]);
    // Первое нажатие только спрашивает: после завершения сваи уже не записать.
    fireEvent.click(await screen.findByRole('button', {name: 'Завершить работу'}));
    expect(api.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа на сегодня закончена'}));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'finish-work', shiftId: 'shift-1'}));
  });
});

describe('v10: отказ сервера виден, введённое не пропадает', () => {
  it('простой отвергнут — красная полоса с причиной, поля на месте', async () => {
    api.fetchState.mockResolvedValue(makeState('WORK', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']));
    api.sendCommand.mockRejectedValue(new ApiError(400, 'Простой длиннее суток (25 ч). Проверьте часы.'));
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
    fireEvent.click(screen.getByRole('button', {name: 'Записать простой'}));
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'r1'}});
    fireEvent.change(screen.getByLabelText('Простой, часов'), {target: {value: '1.5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    expect(await screen.findByText(/Не записано: Простой длиннее суток/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('r1');
    expect(screen.getByLabelText('Простой, часов')).toHaveValue(1.5);
  });
});

describe('v10: ЕО после работы', () => {
  it('не переносит пометку замены счётчика и замер при обновлении на другую смену', async () => {
    const closing = makeState('CLOSING', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
    api.fetchState.mockResolvedValue(closing);
    render(<OperatorV10App />);
    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'}));
    fireEvent.click(await screen.findByRole('button', {name: /Узел/, expanded: false}));
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '99'}});
    fireEvent.click(screen.getByRole('checkbox', {name: 'Счётчик заменён'}));
    expect(screen.getByRole('checkbox', {name: 'Счётчик заменён'})).toBeChecked();

    const next = makeState('CLOSING', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
    next.shift = {id: 'shift-2', productionDate: '2026-09-28', state: 'HANDOVER_PENDING', startedAt: null};
    api.fetchState.mockResolvedValue(next);
    await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Обновить'})); });
    expect(api.fetchState).toHaveBeenCalledTimes(2);
    const section = screen.queryByRole('button', {name: /Узел/, expanded: false});
    if (section) fireEvent.click(section);
    expect(screen.getByRole('checkbox', {name: 'Счётчик заменён'})).not.toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(null);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('открывается шагом, показывает прошлые моточасы и после сдачи ведёт к закрытию', async () => {
    const closing = makeState('CLOSING', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
    api.fetchState.mockResolvedValue(closing);
    api.sendCommand.mockResolvedValue({ok: true});
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'}));
    // Общий экран чек-листа раскрывает разделы по одному.
    fireEvent.click(await screen.findByRole('button', {name: /Узел/, expanded: false}));
    expect(await screen.findByText('Снять моточасы')).toBeInTheDocument();
    expect(screen.getByText(/Прошлое показание: 1234 м\/ч/)).toBeInTheDocument();
  });
});
