import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

// Экран тянет рабочий обзор оператора, а тот — стили PostCSS; в тесте они не нужны.
vi.mock('@/components/piling/operator-mobile/operator-concept.css', () => ({}));

const api = vi.hoisted(() => ({
  sendCommand: vi.fn<(arg: {command: string}) => Promise<unknown>>(async () => ({ok: true})),
  fetchState: vi.fn<() => Promise<unknown>>(),
  queued: [] as unknown[],
  flush: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/components/piling/operator-mobile/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/piling/operator-mobile/api')>()),
  sendCommand: api.sendCommand,
  fetchState: api.fetchState,
}));

vi.mock('@/components/piling/operator-mobile/use-offline-queue', () => ({
  useOfflineQueue: () => ({
    queued: api.queued,
    flush: api.flush,
    retry: vi.fn(),
    retryFailed: vi.fn(),
    discard: vi.fn(),
  }),
}));

const authFetch = vi.hoisted(() => vi.fn<(url: string) => Promise<unknown>>());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  authFetch,
}));

import {OperatorShiftV2} from '../operator-shift-v2';
import {workStateFixture} from '@/components/piling/operator-mobile/__tests__/fixtures';

/**
 * D-20260927-005: у бригады нет сменщиков, и передача смены в v2 оставляла
 * смену в HANDOVER_PENDING без принимающего коллеги. Планировщик такие смены не закрывает.
 *
 * Отчёт и закрытие — одно нажатие и одна команда `close-shift`, как в остальных
 * модулях. Передачи (`handover`) экран не шлёт вовсе.
 */
const mobileState = {
  phase: 'CLOSING',
  productionDate: '2026-09-27',
  shift: {id: 'shift-1'},
  assignment: {equipmentId: 'eq-1'},
  receipt: null,
  production: {
    piles: {count: 12, meters: 168},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
  entries: [],
  checklists: [{stage: 'EO_AFTER', done: true}],
  dictionaries: {pileGrades: [], drillingTypes: [], downtimeReasons: []},
} as unknown as OperatorMobileState;

const facts = {
  shift: {id: 'shift-1', state: 'STARTED', startedAt: '2026-09-27T04:00:00.000Z'},
  clearance: {blockers: [], documents: []},
  assignments: [{equipmentId: 'eq-1', siteId: 'site-1'}],
  equipment: {id: 'eq-1', name: 'LRH 100'},
  meterCurrent: 1240,
  report: {status: 'draft'},
  incomingHandover: null,
};

const closeButton = () => screen.findByRole('button', {name: 'Закрыть смену и отправить отчёт'});

describe('T12: следующий шаг v2 выполняет общий переход', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.queued = [];
    api.sendCommand.mockResolvedValue({ok: true});
    authFetch.mockResolvedValue({ok: true, json: async () => ({...facts,
      clearance: {...facts.clearance, warnings: []},
    })});
  });

  it('из допуска открывает именно непроверенные СИЗ, не принимает установку', async () => {
    const base = workStateFixture();
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'IDENTITY', identity: {
      ...base.identity, ppe: {...base.identity.ppe, confirmed: false},
    }}));
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: СИЗ'}));
    expect(await screen.findByRole('button', {name: /Комплект в порядке/})).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['PRESHIFT_INSPECTION', 'PRESHIFT_INSPECTION', 'Предсменный осмотр'],
    ['SITE_READY', 'SITE_READY', 'Осмотр площадки'],
    ['STARTUP', 'EO_BEFORE', 'Пуск и ЕО перед работой'],
    ['CLOSING', 'EO_AFTER', 'ЕО после работы'],
  ] as const)('в фазе %s раскрывает осмотр, не отвечает за оператора', async (phase, stage, title) => {
    api.fetchState.mockResolvedValue(workStateFixture({phase, checklists: [{
      stage, title, purpose: 'Проверить машину', version: 'test-1', done: false, period: null,
      sections: [{id: 'cab', title: 'Кабина', items: [{id: 'glass', text: 'Стёкла и зеркала', severity: 'NOTE'}]}],
    }]}));
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: `Следующий шаг: ${title}`}));
    await waitFor(() => expect(screen.getByRole('button', {name: /Кабина/, expanded: true})).toHaveFocus());
    expect(screen.getByText('Стёкла и зеркала')).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: `Следующий шаг: ${title}`}));
    expect(screen.getByRole('button', {name: /Кабина/, expanded: true})).toHaveFocus();
  });

  it('из работы без записей открывает форму свай, не записывает выработку', async () => {
    api.fetchState.mockResolvedValue(workStateFixture({dictionaries: {
      pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}], drillingTypes: [], downtimeReasons: [],
    }}));
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Ещё'}));
    fireEvent.click(screen.getByRole('button', {name: 'Следующий шаг: Записать выработку'}));
    expect(await screen.findByLabelText('Марка сваи')).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('сохраняет введённые моточасы и ведёт к завершению заполненного осмотра без отправки', async () => {
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'STARTUP', checklists: [{
      stage: 'EO_BEFORE', title: 'ЕО перед работой', purpose: 'Проверить машину', version: 'test-1', done: false, period: null,
      sections: [{id: 'cab', title: 'Кабина', items: [{id: 'meter', text: 'Моточасы сняты', severity: 'NOTE',
        measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
      }]}],
    }]}));
    render(<OperatorShiftV2 />);
    const next = await screen.findByRole('button', {name: 'Следующий шаг: Пуск и ЕО перед работой'});
    fireEvent.click(next);
    fireEvent.click(screen.getByRole('button', {name: 'Норма'}));
    fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '3001'}});
    fireEvent.click(next);
    expect(screen.getByRole('spinbutton')).toHaveValue(3001);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Завершить'})).toHaveFocus());
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('при записанной выработке просит подтверждение общего завершения работы', async () => {
    const base = workStateFixture();
    let current: OperatorMobileState = {...base, entries: [{
      id: 'pile-1', kind: 'PILES', label: 'С 20-35', value: 2, meters: 12,
      occurredAt: '2026-10-07T08:00:00Z', corrections: [],
    }]};
    api.fetchState.mockImplementation(async () => current);
    api.sendCommand.mockImplementation(async ({command}) => {
      if (command === 'finish-work') current = {...current, phase: 'CLOSING', checklists: [{
        stage: 'EO_AFTER', title: 'ЕО после работы', purpose: 'Проверить машину', version: 'test-1',
        done: false, period: null, sections: [{id: 'cab', title: 'Кабина', items: [{id: 'glass', text: 'Стёкла и зеркала', severity: 'NOTE'}]}],
      }]};
      return {ok: true};
    });
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Завершить работу'}));
    expect(screen.getByRole('button', {name: 'Да, завершить'})).toBeInTheDocument();
    expect(api.sendCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Да, завершить'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'finish-work', shiftId: 'shift-1'}));
    expect(await screen.findByRole('button', {name: 'Следующий шаг: ЕО после работы'})).toBeInTheDocument();
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('на приёмке ведёт к выбору установки и затем к приёмке без открытия смены', async () => {
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'ADMISSION', shift: null}));
    authFetch.mockResolvedValue({ok: true, json: async () => ({...facts, shift: null,
      clearance: {...facts.clearance, warnings: []}, assignments: [{equipmentId: 'eq-1', equipmentName: 'LRH 100', siteId: 'site-1'}],
    })});
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Принять установку'}));
    const choice = screen.getByRole('button', {name: /LRH 100/, pressed: false});
    await waitFor(() => expect(choice).toHaveFocus());
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', {name: 'Следующий шаг: Принять установку'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Принять установку'})).toHaveFocus());
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('при ожидании допуска показывает обновление и не открывает смену', async () => {
    api.fetchState.mockResolvedValue(workStateFixture({phase: 'IDENTITY'}));
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Допуск'}));
    expect(await screen.findByText(/Проверьте состояние допуска/)).toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledTimes(2);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('при ошибке обновления допуска не сообщает об успешном обновлении', async () => {
    api.fetchState.mockResolvedValueOnce(workStateFixture({phase: 'IDENTITY'}))
      .mockRejectedValueOnce(new Error('Не удалось загрузить допуск'));
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Допуск'}));
    expect(await screen.findByText(/Проверьте состояние допуска/)).toBeInTheDocument();
    expect(screen.queryByText(/Допуск обновлён/)).not.toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledTimes(2);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('на отчёте фокусирует сдачу, не отправляя отчёт автоматически', async () => {
    api.fetchState.mockResolvedValue(mobileState);
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Закрыть смену'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'})).toHaveFocus());
    expect(api.sendCommand).not.toHaveBeenCalled();
  });

  it('при несданной очереди ведёт к отправке записей и сохраняет запрет сдачи', async () => {
    api.fetchState.mockResolvedValue(mobileState);
    api.queued = [{clientCommandId: 'cmd-1', state: 'PENDING', label: 'Свая', command: {command: 'log-production'}, queuedAt: new Date().toISOString(), attempts: 1, lastError: null}];
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Закрыть смену'}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Отправить сейчас'})).toHaveFocus());
    expect(await closeButton()).toBeDisabled();
    expect(api.sendCommand).not.toHaveBeenCalled();
    expect(api.flush).not.toHaveBeenCalled();
  });
});

describe('закрытие смены v2 одной командой (D-20260927-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.queued = [];
    api.fetchState.mockResolvedValue(mobileState);
    authFetch.mockResolvedValue({ok: true, json: async () => facts});
  });

  it('закрывает смену командой close-shift и не шлёт передачу', async () => {
    render(<OperatorShiftV2 />);
    fireEvent.click(await closeButton());

    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({
      command: 'close-shift', shiftId: 'shift-1', comment: '',
    }));
    expect(api.sendCommand).toHaveBeenCalledTimes(1);
    expect(authFetch.mock.calls.every(([url]) => !String(url).includes('handover'))).toBe(true);
  });

  it('держит кнопку выключенной, пока очередь на телефоне не пуста', async () => {
    api.queued = [{
      clientCommandId: 'cmd-1',
      state: 'PENDING',
      label: 'Свая',
      command: {command: 'log-production'},
      queuedAt: new Date().toISOString(),
      attempts: 1,
      lastError: null,
    }];

    render(<OperatorShiftV2 />);
    const button = await closeButton();
    expect(button).toBeDisabled();

    expect(screen.getByText(/Сначала отправьте записи с телефона: 1 не отправлено/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(api.sendCommand).not.toHaveBeenCalled();
  });
});

describe('I1: ручная сдача HANDOVER_PENDING в v2', () => {
  let current: OperatorMobileState;
  beforeEach(() => {
    vi.clearAllMocks();
    api.queued = [];
    current = workStateFixture({
      phase: 'CLOSING', productionDate: '2026-10-07', receipt: null,
      shift: {id: 'shift-1', productionDate: '2026-09-27', startedAt: '2026-09-27T04:00:00Z', state: 'HANDOVER_PENDING'},
      checklists: [...workStateFixture().checklists, {
        stage: 'EO_AFTER', title: 'ЕО после работы', purpose: 'Проверить машину', version: 'test-1',
        done: false, period: null,
        sections: [{id: 'cab', title: 'Кабина', items: [{id: 'glass', text: 'Стёкла и зеркала', severity: 'NOTE'}]}],
      }],
      dictionaries: {
        pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}], drillingTypes: [],
        downtimeReasons: [{id: 'reason-1', name: 'Нет фронта работ'}],
      },
    });
    api.fetchState.mockImplementation(async () => current);
    authFetch.mockResolvedValue({ok: true, json: async () => ({...facts, shift: {...facts.shift, state: 'HANDOVER_PENDING'}})});
    api.sendCommand.mockImplementation(async ({command}) => {
      if (command === 'submit-checklist') current = {
        ...current, checklists: current.checklists.map((list) => list.stage === 'EO_AFTER' ? {...list, done: true} : list),
      };
      return {ok: true};
    });
  });

  it('проходит ЕО после работы, дописывает прежнюю смену и закрывает её без передачи', async () => {
    render(<OperatorShiftV2 />);
    fireEvent.click(await screen.findByRole('button', {name: /Кабина/, expanded: false}));
    expect(screen.getByText('Стёкла и зеркала')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Закрыть смену и отправить отчёт'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Весь раздел «Кабина» в норме'}));
    fireEvent.click(screen.getByRole('button', {name: 'Завершить'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'submit-checklist', shiftId: 'shift-1', equipmentId: 'eq-1', stage: 'EO_AFTER',
      answers: [expect.objectContaining({itemId: 'glass', answer: 'OK'})],
    })));
    await closeButton();
    fireEvent.click(screen.getByRole('button', {name: 'Дописать сваи, бурение или простой'}));
    fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
    fireEvent.change(screen.getByLabelText('Марка сваи'), {target: {value: 'grade-1'}});
    fireEvent.change(screen.getByLabelText('Количество свай'), {target: {value: '3'}});
    fireEvent.click(screen.getByRole('button', {name: 'Добавить 3 шт'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'log-production', shiftId: 'shift-1', entry: {kind: 'PILES', pileGradeId: 'grade-1', count: 3},
    })));
    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));
    fireEvent.click(await closeButton());
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith({command: 'close-shift', shiftId: 'shift-1', comment: ''}));
    expect(authFetch.mock.calls.every(([url]) => !url.includes('handover'))).toBe(true);
  });

  it('дописывает часовой простой и возвращается кнопкой «К сдаче смены»', async () => {
    current = {...current, checklists: current.checklists.map((list) => list.stage === 'EO_AFTER' ? {...list, done: true} : list)};
    render(<OperatorShiftV2 />);
    await closeButton();
    fireEvent.click(screen.getByRole('button', {name: 'Дописать сваи, бурение или простой'}));
    expect(screen.queryByRole('button', {name: 'Завершить работу'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Простой'}));
    fireEvent.change(screen.getByLabelText('Причина'), {target: {value: 'reason-1'}});
    fireEvent.change(screen.getByLabelText('Простой, часов'), {target: {value: '1.5'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать простой'}));
    await waitFor(() => expect(api.sendCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: 'log-production', shiftId: 'shift-1', entry: {kind: 'DOWNTIME', reasonId: 'reason-1', hours: 1.5, comment: undefined},
    })));
    fireEvent.click(screen.getByRole('button', {name: 'К сдаче смены'}));
    expect(await closeButton()).toBeEnabled();
    expect(screen.queryByRole('button', {name: 'Добавить сваю'})).not.toBeInTheDocument();
  });
});
