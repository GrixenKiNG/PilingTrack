/**
 * Кнопка «Следующий шаг» на живом экране машиниста v1 (решение владельца
 * 09.10.2026): круглая кнопка в нижнем меню между «ТБ» и «Техникой» (а где меню
 * нет — одна в нижней полосе), ведёт к действию по фазе сервера; панель «Главная /
 * Завершить смену» убрана. Выработку и простой можно дописать после
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

describe('v1: кнопка «Следующий шаг»', () => {
  it('на приёмке «Следующий шаг» ведёт к действию приёмки, не открывая смену сам', async () => {
    current = workStateFixture({phase: 'ADMISSION', shift: null,
      options: [{crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А'}],
      assignment: {equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А', lastMeter: null,
        maintenance: {daysLeft: null}, siteDowntimeHours: 0, siteDowntimeEvents: 0,
        sitePiles: {count: 0, meters: 0}, siteDrilling: {count: 0, meters: 0}, fuelPercent: null, assistants: []},
    } as unknown as Partial<OperatorMobileState>);
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Принять установку'}));
    expect(screen.getByRole('button', {name: 'Принять и открыть смену'})).toHaveFocus();
    expect(commands).toHaveLength(0);
  });

  it.each([
    ['PRESHIFT_INSPECTION', 'PRESHIFT_INSPECTION', 'Предсменный осмотр'],
    ['SITE_READY', 'SITE_READY', 'Осмотр площадки'],
    ['STARTUP', 'EO_BEFORE', 'Пуск и ЕО перед работой'],
    ['CLOSING', 'EO_AFTER', 'ЕО после работы'],
  ] as const)('%s: «Следующий шаг» раскрывает осмотр и сохраняет введённое', async (phase, stage, title) => {
    current = workStateFixture({phase, checklists: [{stage, title, purpose: '', version: '1', period: null, done: false,
      sections: [{id: 'machine', title: 'Узел', items: [{id: 'check', text: 'Проверить установку', severity: 'NOTE'}]}],
    }]});
    render(<OperatorMobileApp />);
    const next = await screen.findByRole('button', {name: `Следующий шаг: ${title}`});
    fireEvent.click(next);
    expect(screen.getByRole('button', {name: /Узел/, expanded: true})).toHaveFocus();
    fireEvent.click(screen.getByRole('button', {name: 'Замечание'}));
    const note = screen.getByRole('textbox');
    fireEvent.change(note, {target: {value: 'Подтёк масла'}});
    fireEvent.click(next);
    expect(screen.getByRole('textbox')).toHaveValue('Подтёк масла');
    expect(screen.getByRole('button', {name: /Узел/, expanded: true})).toHaveFocus();
    expect(commands).toHaveLength(0);
  });

  it('в сдаче «Следующий шаг» ведёт к кнопке сдачи, а закрывает только явное нажатие', async () => {
    current = workStateFixture({phase: 'CLOSING', checklists: [{stage: 'EO_AFTER', done: true}] as OperatorMobileState['checklists']});
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Закрыть смену'}));
    const close = screen.getByRole('button', {name: 'Закрыть смену и отправить отчёт'});
    expect(close).toHaveFocus();
    expect(commands).toHaveLength(0);
    fireEvent.click(close);
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({command: 'close-shift', shiftId: 'shift-1'});
  });

  it('в работе кнопка стоит в меню между «ТБ» и «Техникой», а шаг — «Записать выработку», пока записей нет', async () => {
    render(<OperatorMobileApp />);

    const next = await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'});
    const menu = screen.getByRole('navigation', {name: 'Разделы смены'});
    const labels = Array.from(menu.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim());
    const at = (text: string) => labels.findIndex((label) => label?.startsWith(text));
    expect(menu).toContainElement(next);
    expect(at('Следующий шаг')).toBe(at('ТБ') + 1);
    expect(at('Техника')).toBe(at('Следующий шаг') + 1);
    // Прежней панели больше нет.
    expect(screen.queryByRole('button', {name: 'Главная'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Завершить смену'})).toBeNull();
  });

  it('«Следующий шаг» в работе открывает форму записи', async () => {
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Записать выработку'}));

    await waitFor(() => expect(visible(screen.getByLabelText('Марка сваи'))).toBe(true));
  });

  it('шаг «Завершить работу» (записи есть) просит подтверждение и только потом шлёт finish-work', async () => {
    current = {...(workState as object), entries: [{
      id: 'e1', kind: 'PILES', label: 'С 300.30-6', value: 2, meters: 12,
      occurredAt: '2026-09-20T06:00:00.000Z', corrections: [],
    }]};
    render(<OperatorMobileApp />);

    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Завершить работу'}));
    expect(commands).toHaveLength(0);
    expect(screen.getAllByRole('alertdialog').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', {name: 'Да, завершить'})[0]);
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({command: 'finish-work', shiftId: 'shift-1'});
  });

  it('до работы кнопка есть, а «Завершить смену» и «Главная» нет', async () => {
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
    expect(screen.queryByRole('button', {name: 'Завершить смену'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Главная'})).toBeNull();
    expect(commands).toHaveLength(0);
  });

  it('на осмотре нижних вкладок нет — кнопка стоит одна в нижней полосе', async () => {
    current = workStateFixture({phase: 'PRESHIFT_INSPECTION', checklists: [{stage: 'PRESHIFT_INSPECTION', title: 'Предсменный осмотр', purpose: '', version: '1', period: null, done: false,
      sections: [{id: 'machine', title: 'Узел', items: [{id: 'check', text: 'Проверить установку', severity: 'NOTE'}]}],
    }]});
    render(<OperatorMobileApp />);
    fireEvent.click(await screen.findByRole('button', {name: 'Следующий шаг: Предсменный осмотр'}));

    const dock = await screen.findByRole('navigation', {name: 'Следующий шаг смены'});
    expect(dock.querySelectorAll('button')).toHaveLength(1);
    expect(screen.queryByRole('navigation', {name: 'Разделы смены'})).toBeNull();
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
