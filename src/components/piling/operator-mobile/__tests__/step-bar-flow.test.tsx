/**
 * Нижняя панель шагов на живом экране машиниста v1 (решение владельца 07.10.2026):
 * «Главная», «Следующий шаг», «Завершить смену» стоят на каждом экране, ведут к
 * действию по фазе сервера, а выработку и простой можно дописать после
 * «Завершить работу» — до сдачи смены.
 */
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

vi.mock('../operator-type.css', () => ({}));
vi.mock('../operator-concept.css', () => ({}));

import {OperatorMobileApp} from '../operator-mobile-app';
import {workStateFixture} from './fixtures';

const workState = workStateFixture({
  shift: {id: 'shift-1', productionDate: '2026-09-20', startedAt: '2026-09-20T05:00:00.000Z', state: 'STARTED'},
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'TB_PILING', 'TB_DRILLING']
    .map((stage) => ({stage, done: true})) as unknown as OperatorMobileState['checklists'],
  dictionaries: {
    pileGrades: [{id: 'g1', name: 'С 300.30-6', lengthMm: 6000}],
    drillingTypes: [],
    downtimeReasons: [{id: 'r1', name: 'Ожидание бетона'}],
  } as unknown as OperatorMobileState['dictionaries'],
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

let current: unknown;
const commands: Record<string, unknown>[] = [];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('/api/operator/mobile/state')) return jsonResponse({data: current});
  if (url === '/api/operator/mobile/command') {
    commands.push(JSON.parse(String(init?.body ?? '{}')));
    return jsonResponse({data: {reportId: 'r1'}});
  }
  throw new Error(`неожиданный запрос в тесте: ${url}`);
});

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
  Object.defineProperty(globalThis.navigator, 'onLine', {configurable: true, value: true});
  commands.length = 0;
  current = workState;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const visible = (node: HTMLElement) => node.closest('[hidden]') === null;

describe('v1: нижняя панель шагов', () => {
  it('в работе стоят три кнопки, а шаг — «Записать выработку», пока записей нет', async () => {
    render(<OperatorMobileApp />);

    expect(await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'})).toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: 'Главная'}).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', {name: 'Завершить смену'}).length).toBeGreaterThan(0);
  });

  it('«Следующий шаг» в работе открывает форму записи', async () => {
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'}));

    await waitFor(() => expect(visible(screen.getByLabelText('Марка сваи'))).toBe(true));
  });

  it('«Главная» возвращает из формы к обзору смены', async () => {
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'}));
    await waitFor(() => expect(visible(screen.getByLabelText('Марка сваи'))).toBe(true));

    fireEvent.click(screen.getAllByRole('button', {name: 'Главная'})[0]);

    await waitFor(() => expect(visible(screen.getByLabelText('Марка сваи'))).toBe(false));
  });

  it('«Завершить смену» в работе просит подтверждение и только потом шлёт finish-work', async () => {
    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'});

    fireEvent.click(screen.getAllByRole('button', {name: 'Завершить смену'})[0]);
    expect(commands).toHaveLength(0);
    expect(screen.getAllByRole('alertdialog').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', {name: 'Да, завершить'})[0]);
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({command: 'finish-work', shiftId: 'shift-1'});
  });

  it('до работы «Завершить смену» не нажимается и называет, что сделать сначала', async () => {
    current = workStateFixture({
      phase: 'ADMISSION',
      shift: null,
      options: [{crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А'}],
      assignment: {
        equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А', lastMeter: null,
        maintenance: {daysLeft: null}, siteDowntimeHours: 0, siteDowntimeEvents: 0,
        sitePiles: {count: 0, meters: 0}, siteDrilling: {count: 0, meters: 0}, fuelPercent: null, assistants: [],
      },
    } as unknown as Partial<OperatorMobileState>);
    render(<OperatorMobileApp />);

    expect(await screen.findByRole('button', {name: 'Следующий шаг: Принять установку'})).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', {name: 'Завершить смену'})[0]);

    expect((await screen.findAllByText(/Сейчас: принять установку/)).length).toBeGreaterThan(0);
    expect(commands).toHaveLength(0);
  });

  it('в допуске «Следующий шаг» ведёт к первому непройденному — СИЗ', async () => {
    current = workStateFixture({
      phase: 'IDENTITY',
      shift: null,
      operator: {id: 'op-1', name: 'Иванов'},
      identity: {
        ppe: {confirmed: false, missing: [], items: []},
        briefing: {ok: false, acknowledgedAt: null, title: 'Инструкция'},
        knowledge: {ok: false, validUntil: null, lastResult: null},
        documents: [],
      },
    } as unknown as Partial<OperatorMobileState>);
    render(<OperatorMobileApp />);

    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: СИЗ'}));

    expect(await screen.findByText('Средства защиты')).toBeInTheDocument();
  });
});

describe('v1: выработку можно дописать после «Завершить работу»', () => {
  const closing = () => workStateFixture({
    phase: 'CLOSING',
    shift: {id: 'shift-1', productionDate: '2026-09-20', startedAt: '2026-09-20T05:00:00.000Z', state: 'HANDOVER_PENDING'},
    checklists: [...workState.checklists, {stage: 'EO_AFTER', done: true}] as unknown as OperatorMobileState['checklists'],
    dictionaries: workState.dictionaries,
  });

  it('в сдаче есть «Дописать сваи, бурение или простой»; форма открыта и ведёт обратно к сдаче', async () => {
    current = closing();
    render(<OperatorMobileApp />);

    fireEvent.click(await screen.findByRole('button', {name: 'Дописать сваи, бурение или простой'}));

    expect(await screen.findByRole('button', {name: '← К сдаче смены'})).toBeInTheDocument();
    expect(visible(screen.getByLabelText('Марка сваи'))).toBe(true);
    // Работа уже завершена — кнопки «Работа завершена» здесь нет.
    expect(screen.queryByRole('button', {name: 'Работа завершена'})).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: '← К сдаче смены'}));
    expect(await screen.findByRole('button', {name: 'Закрыть смену и отправить отчёт'})).toBeInTheDocument();
  });

  it('запись после завершения работы уходит на сервер той же командой', async () => {
    current = closing();
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Дописать сваи, бурение или простой'}));

    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByLabelText('Свай, шт'), {target: {value: '3'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      command: 'log-production', shiftId: 'shift-1',
      entry: {kind: 'PILES', pileGradeId: 'g1', count: 3},
    });
  });
});
