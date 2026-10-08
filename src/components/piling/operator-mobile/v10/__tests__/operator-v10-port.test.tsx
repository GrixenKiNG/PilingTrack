/**
 * F-V10-PORT: доработки прежнего экрана v10, перенесённые на новый.
 *
 * Экран переписан 28.09.2026 (смена строго по шагам, общий экран чек-листа), и
 * вместе со старой разметкой пропали правила, за которые экран уже получал
 * замечания владельца: итог допуска, границы простоя до отправки и закрытие
 * смены при непустой очереди. Здесь — те же правила на новой разметке:
 * поведение проверяется, структура — нет.
 */
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {PPE_ITEMS} from '@/modules/operator-mobile/contracts';

const api = vi.hoisted(() => ({
  fetchState: vi.fn(),
  sendCommand: vi.fn(),
}));

/** Очередь устройства: тест сам решает, что на телефоне лежит. */
const device = vi.hoisted(() => ({
  queued: [] as {state: string; label: string}[],
  flush: vi.fn(),
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
  useOfflineQueue: () => ({
    queued: device.queued, flush: device.flush, retry: vi.fn(), retryFailed: vi.fn(), discard: vi.fn(),
  }),
}));
vi.mock('../../operator-concept.css', () => ({}));

import {ApiError} from '@/components/piling/operator-mobile/api';
import {OperatorV10App, ppeOutcome} from '../operator-v10-app';

/* ------------------------------------------------------------- состояние --- */

const STAGES = ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'EO_AFTER'] as const;

function checklist(stage: string, done: boolean) {
  return {
    stage,
    title: {PRESHIFT_INSPECTION: 'Предсменный осмотр', SITE_READY: 'Готовность площадки',
      EO_BEFORE: 'ЕО перед работой', EO_AFTER: 'ЕО после работы'}[stage] ?? stage,
    purpose: '', version: '1', done, period: null,
    sections: [{
      id: `${stage}-s`,
      title: stage === 'PRESHIFT_INSPECTION' ? 'Ходовая часть' : 'Узел',
      items: [{id: `${stage}-1`, text: `Пункт ${stage}`, severity: 'NOTE'}],
    }],
  };
}

/** Смена начата сегодня: границы окна простоя сравниваются с её временем. */
function shiftStartedAt(): string {
  const start = new Date();
  start.setHours(7, 20, 0, 0);
  return start.toISOString();
}

function makeState(phase: string, doneStages: string[] = []): OperatorMobileState {
  return {
    phase,
    productionDate: '2026-09-28',
    operator: {id: 'op', name: 'Иванов'},
    identity: {
      ppe: {confirmed: true, missing: [], items: PPE_ITEMS.map((item) => item.code)},
      briefing: {ok: true, acknowledgedAt: '2026-09-28T04:00:00.000Z', title: 'Инструкция по охране труда', version: '1'},
      knowledge: {ok: true, validUntil: null, lastResult: null},
      documents: [],
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
    incidents: [],
    shift: {id: 'shift-1', productionDate: '2026-09-28', startedAt: shiftStartedAt(), state: 'OPEN'},
    checklists: STAGES.map((stage) => checklist(stage, doneStages.includes(stage))),
    entries: [],
    production: {piles: {count: 0, meters: 0}, drilling: {count: 0, meters: 0}, downtimeHours: 0},
    dictionaries: {
      pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}],
      drillingTypes: [],
      downtimeReasons: [{id: 'r1', name: 'Ремонт установки'}],
    },
    receipt: null,
  } as unknown as OperatorMobileState;
}

function workState() {
  return makeState('WORK', ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE']);
}

it('v10: кнопки выбора записи называют действие глаголом (I5)', async () => {
  api.fetchState.mockResolvedValue(workState());
  render(<OperatorV10App />);
  fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Добавить сваю'}));
  for (const name of ['Добавить сваю', 'Записать паспорт сваи', 'Добавить бурение', 'Записать простой']) {
    expect(screen.getByRole('button', {name})).toBeInTheDocument();
  }
});

beforeEach(() => {
  api.fetchState.mockReset();
  api.sendCommand.mockReset();
  device.queued = [];
  device.flush.mockReset();
  // Раздел ТБ читает свой допуск отдельным запросом; отдаём пустой, но
  // правильной формы ответ — экран разбирает его без проверки полей.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    clearance: {cleared: false, blockers: [], documents: []},
    briefings: {pending: [], overdue: []},
    history: [],
  }), {status: 200})));
});

/* ------------------------------------------- 1. итог подтверждения СИЗ --- */

/**
 * D-20260927-003: подтверждение СИЗ не заканчивало допуск на экране.
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

describe('v10: итог подтверждения СИЗ', () => {
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

  it('показывает итог на экране СИЗ и уводит по «Далее» к инструкции', async () => {
    const state = makeState('IDENTITY');
    // Инструкция ещё не прочитана: «Далее» ведёт к ней, а не объявляет допуск.
    (state.identity as {briefing: unknown}).briefing = {
      ok: false, acknowledgedAt: null, title: 'Инструкция по охране труда', version: '1',
    };
    api.fetchState.mockResolvedValue(state);
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'ТБ'}));
    fireEvent.click(await screen.findByRole('button', {name: /1\. СИЗ/}));

    expect(await screen.findByText('СИЗ подтверждены')).toBeInTheDocument();
    expect(screen.getByText('Дальше: Ознакомление с инструкциями')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Далее'}));
    expect(await screen.findByRole('button', {name: 'Ознакомлен'})).toBeInTheDocument();
  });
});

/* ------------------------------------------------ 2. простой в часах --- */

/**
 * Решение владельца 07.10.2026: простой — только часы, без привязки ко времени
 * работы в программе. Окно смены и «не позже сейчас» больше не проверяются.
 */
describe('v10: простой в часах', () => {
  const openDowntimeForm = async () => {
    api.fetchState.mockResolvedValue(workState());
    const view = render(<OperatorV10App />);
    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
    fireEvent.click(screen.getByRole('button', {name: 'Записать простой'}));
    fireEvent.change(screen.getByRole('combobox'), {target: {value: 'r1'}});
    return view;
  };

  it('вместо времени начала и конца — одно поле «Простой, часов»', async () => {
    const {container} = await openDowntimeForm();

    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(screen.getByLabelText('Простой, часов')).toBeInTheDocument();
    expect(screen.queryByText('Закончился сейчас')).toBeNull();
  });

  it('держит «Записать», пока часы не введены или записаны не по шагу четверти часа', async () => {
    await openDowntimeForm();
    const field = screen.getByLabelText('Простой, часов');

    expect(screen.getByRole('button', {name: 'Записать'})).toBeDisabled();
    fireEvent.change(field, {target: {value: '1.3'}});
    expect(await screen.findByText(/с шагом в четверть часа/)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Записать'})).toBeDisabled();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('отправляет введённые часы без начала и конца', async () => {
    api.sendCommand.mockResolvedValue({ok: true});
    await openDowntimeForm();

    fireEvent.change(screen.getByLabelText('Простой, часов'), {target: {value: '1.5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledTimes(1));
    const [command] = api.sendCommand.mock.calls[0];
    expect(command).toMatchObject({command: 'log-production', entry: {kind: 'DOWNTIME', reasonId: 'r1', hours: 1.5}});
    expect(command.entry.startedAt).toBeUndefined();
    expect(command.entry.endedAt).toBeUndefined();
  });

  it('кнопки быстрого выбора — в часах, а не в минутах', async () => {
    await openDowntimeForm();

    fireEvent.click(screen.getByRole('button', {name: '2 ч'}));
    expect((screen.getByLabelText('Простой, часов') as HTMLInputElement).value).toBe('2');
    expect(screen.queryByRole('button', {name: /мин/})).toBeNull();
  });
});

/* ------------------- 3. закрытие смены при непустой очереди устройства --- */

/**
 * F-R43-1: смену нельзя закрыть, пока на телефоне лежат неотправленные записи.
 * Закрытая смена отвечает отложенной выработке 409 «Смена уже закрыта», и в
 * отчёт она не попадает. Экран обязан держать кнопку закрытия.
 */
describe('v10: закрытие смены и очередь устройства', () => {
  const closing = () => makeState('CLOSING',
    ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'EO_AFTER']);

  it('держит закрытие и предлагает отправить записи', async () => {
    device.queued = [
      {state: 'PENDING', label: 'Свая 12 шт.'},
      {state: 'PENDING', label: 'Простой 40 мин'},
    ];
    api.fetchState.mockResolvedValue(closing());
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'}));

    expect(await screen.findByText('Сначала отправьте записи с телефона: 2 не отправлено'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: 'Отправить сейчас'}));
    expect(device.flush).toHaveBeenCalledTimes(1);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь устройства пуста', async () => {
    api.fetchState.mockResolvedValue(closing());
    api.sendCommand.mockResolvedValue({ok: true});
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дальше: ЕО после работы и закрытие смены'}));

    expect(screen.queryByText(/Сначала отправьте записи/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'}));

    await waitFor(() => expect(api.sendCommand)
      .toHaveBeenCalledWith({command: 'close-shift', shiftId: 'shift-1', comment: ''}));
  });
});

/* ------------- 4–5. кнопка записи занята, форма чистится по принятию --- */

/** Обещание, которым тест сам решает, когда закончится перечитывание экрана. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return {promise, resolve};
}

/** Открывает форму свай на «Работе» и вводит «12 шт». Возвращает поле числа. */
async function openPilesForm(container: HTMLElement) {
  fireEvent.click(await screen.findByRole('button', {name: 'Дальше: Работа: сваи, бурение, простой'}));
  fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
  fireEvent.change(container.querySelector('select') as HTMLSelectElement, {target: {value: 'grade-1'}});
  const count = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  fireEvent.change(count, {target: {value: '12'}});
  return count;
}

/**
 * F-R43-3e: кнопка выработки занята, пока экран не перечитан. Ключ команды
 * меняется сразу по её принятию, а счётчики смены приходят только с
 * перечитыванием: отпусти кнопку раньше — машинист нажмёт второй раз, и та же
 * выработка уйдёт с новым ключом, то есть задвоится.
 *
 * F-R43-3b: форма чистится только по подтверждению сервера — при отказе
 * набранное число остаётся на экране рядом с красной полосой.
 */
describe('v10: запись выработки и отказ сервера', () => {
  it('держит кнопку занятой и не отправляет ту же выработку второй раз', async () => {
    const reload = deferred<OperatorMobileState>();
    let calls = 0;
    api.fetchState.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(workState()) : reload.promise;
    });
    api.sendCommand.mockResolvedValue({ok: true});

    const {container} = render(<OperatorV10App />);
    const count = await openPilesForm(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
    // Запись ушла, перечитывание началось и ещё не закончилось.
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);

    const busyButton = screen.getByRole('button', {name: 'Записываем…'});
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    // Форма ещё не очищена: набранное число ждёт подтверждения экрана.
    expect(count.value).toBe('12');

    reload.resolve(workState());

    await waitFor(() => expect(count.value).toBe(''));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('оставляет введённое число, когда сервер отказал', async () => {
    api.fetchState.mockResolvedValue(workState());
    api.sendCommand.mockRejectedValue(new ApiError(400, 'Свая такой марки не заведена'));

    const {container} = render(<OperatorV10App />);
    const count = await openPilesForm(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    expect(await screen.findByText('Не записано: Свая такой марки не заведена')).toBeInTheDocument();
    expect(count.value).toBe('12');
  });
});

/* ------------------------------ 6. кнопка «Следующий шаг» (09.10.2026) --- */

/**
 * Решение владельца 09.10.2026: «Следующий шаг» — круглая кнопка в нижнем меню
 * между «ТБ» и «Техникой»; панель «Главная / Завершить смену» убрана. Следующий
 * шаг определяет фаза сервера.
 */
describe('v10: кнопка «Следующий шаг»', () => {
  it('в работе кнопка стоит в меню между «ТБ» и «Техникой»; прежней панели нет', async () => {
    api.fetchState.mockResolvedValue(workState());
    render(<OperatorV10App />);

    const next = await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'});
    const tabs = Array.from(document.querySelectorAll('.ov10-tabs button'));
    const index = (predicate: (button: Element) => boolean) => tabs.findIndex(predicate);
    expect(tabs).toContain(next);
    expect(index((button) => button === next)).toBe(index((button) => button.getAttribute('data-tab') === 'safety') + 1);
    expect(index((button) => button.getAttribute('data-tab') === 'equip')).toBe(tabs.indexOf(next) + 1);
    expect(screen.queryByRole('button', {name: 'Главная'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Завершить смену'})).toBeNull();
  });

  it('шаг «Завершить работу» спрашивает и только потом шлёт finish-work', async () => {
    api.fetchState.mockResolvedValue({
      ...workState(),
      entries: [{
        id: 'e1', kind: 'PILES', label: 'С 300.30-6', value: 2, meters: 12,
        occurredAt: '2026-09-28T06:00:00.000Z', corrections: [],
      }],
    });
    api.sendCommand.mockResolvedValue({ok: true});
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Завершить работу'}));
    expect(api.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Да, завершить'}));

    await waitFor(() => expect(api.sendCommand)
      .toHaveBeenCalledWith({command: 'finish-work', shiftId: 'shift-1'}));
  });

  it('«Следующий шаг» из допуска ведёт к первому непройденному — СИЗ', async () => {
    const identity = makeState('IDENTITY').identity;
    api.fetchState.mockResolvedValue({
      ...makeState('IDENTITY'),
      identity: {...identity, ppe: {...identity.ppe, confirmed: false}},
    });
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: СИЗ'}));

    expect(await screen.findByText('Средства защиты')).toBeInTheDocument();
  });

  it('в сдаче можно дописать сваи, бурение и простой — открывается полная форма', async () => {
    api.fetchState.mockResolvedValue(makeState('CLOSING',
      ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'EO_AFTER']));
    render(<OperatorV10App />);

    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Закрыть смену'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Дописать сваи, бурение или простой'}));

    // После завершения работы доступны все четыре вида записи, а не только простой.
    expect(await screen.findByRole('button', {name: 'Добавить сваю'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Добавить бурение'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Записать простой'})).toBeInTheDocument();
  });
});
