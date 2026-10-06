import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePilingStore} from '@/lib/store';
import {OperatorNextApp} from '../operator-next-app';
import {makeState} from './fixtures';

/**
 * Задание №10 — доработка по прогону №9.
 *
 * Ж1: быстрый простой «за последние 30 минут» не начинается раньше смены,
 *     а понятная деталь серверного 400 показывается на экране.
 * Ж2: отсутствие пары «пользователь + смена» — не отказ хранилища черновиков.
 *
 * Оснастка повторяет основной сквозной файл: настоящий клиент `api.ts`,
 * подменяется только сеть (`fetch`).
 */

const DEFAULT_USER = {id: 'user-a', email: 'user-a@piling.test', name: 'Машинист А', role: 'OPERATOR' as const};

type Responder = (url: string) => Response | Promise<Response>;

let stateImpl: Responder;
let commandImpl: (body: Record<string, unknown> | null) => Response | Promise<Response>;
let sent: Record<string, unknown>[];

function json(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

beforeEach(() => {
  globalThis.localStorage?.clear();
  usePilingStore.setState({currentUser: DEFAULT_USER});
  sent = [];
  stateImpl = () => json({data: makeState()});
  commandImpl = () => json({data: {ok: true}});
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/operator/mobile/state')) return stateImpl(url);
    if (url.startsWith('/api/operator/mobile/command')) {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      sent.push(body ?? {});
      return commandImpl(body);
    }
    return json({error: 'нет маршрута'}, 404);
  }) as unknown as typeof fetch;
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hhmm(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Открыть форму простоя с причиной — как это делает машинист. */
async function openDowntimeForm() {
  await screen.findByText('Запишите результат работы');
  fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
  fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
}

const WARNING = /Черновик не сохранится при перезагрузке страницы/;

describe('№10, Ж2: «нет пары» — не отказ хранилища черновиков', () => {
  it('пока пользователь неизвестен, ложное «Черновик не сохранится» не показывается', async () => {
    usePilingStore.setState({currentUser: null});
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);

    await screen.findByText('Запишите результат работы');
    // Список работы: память браузера исправна — предупреждению взяться неоткуда.
    expect(screen.queryByText(WARNING)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    await screen.findByRole('button', {name: /С 100\.30/});
    // На форме — только честная подсказка, ложной нет.
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(screen.getByText(/Набранное сохраняется при переходах/)).toBeInTheDocument();
  });
});

describe('№10, Ж1: быстрый простой не заходит раньше начала смены', () => {
  it('смена начата 10 минут назад: интервал не уходит раньше начала смены', async () => {
    const shiftStart = new Date(Date.now() - 10.5 * 60_000);
    stateImpl = () => json({data: makeState({
      phase: 'WORK',
      shift: {id: 'shift-1', productionDate: '2026-09-27', startedAt: shiftStart.toISOString(), state: 'STARTED'},
    })});
    render(<OperatorNextApp />);
    await openDowntimeForm();

    // Вариант «за последние 30 минут» не предлагается: окно обрезано до смены.
    expect(screen.queryByRole('button', {name: /за последние 30 минут/})).toBeNull();
    const quick = screen.getByRole('button', {name: /с начала смены, 10 мин/});
    fireEvent.click(quick);

    expect(screen.getByLabelText(/^Начало/)).toHaveValue(hhmm(shiftStart));
    expect(screen.getByLabelText(/^Конец/)).toHaveValue(hhmm(new Date()));

    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
    const entry = sent[sent.length - 1].entry as {kind: string; startedAt: string};
    expect(entry.kind).toBe('DOWNTIME');
    // Начало — не раньше смены (минутная точность поля не даёт уйти дальше минуты).
    expect(new Date(entry.startedAt).getTime()).toBeGreaterThanOrEqual(shiftStart.getTime() - 61_000);
    expect(new Date(entry.startedAt).getTime()).toBeLessThanOrEqual(shiftStart.getTime() + 61_000);
  });

  it('смена идёт давно: вариант «за последние 30 минут» остаётся прежним', async () => {
    const shiftStart = new Date(Date.now() - 3 * 3_600_000);
    stateImpl = () => json({data: makeState({
      phase: 'WORK',
      shift: {id: 'shift-1', productionDate: '2026-09-27', startedAt: shiftStart.toISOString(), state: 'STARTED'},
    })});
    render(<OperatorNextApp />);
    await openDowntimeForm();
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
    const entry = sent[sent.length - 1].entry as {kind: string; startedAt: string};
    expect(entry.kind).toBe('DOWNTIME');
    const startedMs = new Date(entry.startedAt).getTime();
    expect(Math.abs(Date.now() - 30 * 60_000 - startedMs)).toBeLessThanOrEqual(5 * 60_000);
  });

  it('отказ 400 с понятной деталью сервера показывается на экране', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    commandImpl = () => json({error: 'Простой не может начаться раньше смены — смена начата в 09:15.'}, 400);
    render(<OperatorNextApp />);
    await openDowntimeForm();
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));

    // Новый контракт очереди (main): отклонённая по существу запись остаётся
    // видимой, поэтому текст причины встречается дважды — в плашке очереди и в
    // полосе ошибки формы. Проверяем присутствие, а не единственность.
    const detailCopies = await screen.findAllByText(/Простой не может начаться раньше смены — смена начата в 09:15\./);
    expect(detailCopies.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="offline-queue-banner"]')?.textContent ?? '')
      .toContain('Простой не может начаться раньше смены — смена начата в 09:15.');
    expect(screen.queryAllByText(/Сервер не принял данные: проверьте заполненное/)).toHaveLength(0);
  });

  it('техническая отписка без детали остаётся общим текстом', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    commandImpl = () => json({error: 'Некорректная команда'}, 400);
    render(<OperatorNextApp />);
    await openDowntimeForm();
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));

    // Новый контракт (main): «Некорректная команда» переводится в человеческую
    // подсказку на слое API (BAD_COMMAND_HINT), а запись остаётся в очереди
    // видимой. Сырая техническая строка машинисту не показывается.
    expect((await screen.findAllByText(/Не удалось отправить — обновите экран и повторите/)).length)
      .toBeGreaterThan(0);
    expect(screen.queryAllByText(/Некорректная команда/)).toHaveLength(0);
  });
});