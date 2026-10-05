import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePilingStore} from '@/lib/store';
import {OperatorNextApp} from '../operator-next-app';
import {checklistView, makeState} from './fixtures';

/**
 * Итерация по просьбе владельца (05.10.2026):
 *  1) механик заполняет отчёт ПОСЛЕ смены — простой должен записываться и в
 *     момент сдачи (на экране закрытия, после «Завершить работу»);
 *  2) повторная попытка воспроизвести единичный сбой восстановления черновика
 *     паспорта со «свежей» парой (прогон №10, проход B): смена создаётся по
 *     ходу сессии, паспорт заполняется, затем страница «перезагружается».
 *
 * Оснастка — как в проверках №10: настоящий клиент api.ts, подмена только сети.
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

describe('простой при сдаче смены (итерация владельца 05.10)', () => {
  it('после «Завершить работу» простой можно записать прямо на экране закрытия', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    // Механик заполняет отчёт после смены: простоя в записях ещё нет — есть кнопка.
    fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
    await screen.findByText('Причина простоя');
    fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));

    await waitFor(() => expect(sent.some((c) => c.command === 'log-production')).toBe(true));
    const entry = sent[sent.length - 1].entry as {kind: string};
    expect(entry.kind).toBe('DOWNTIME');
    // После записи экран возвращается к сдаче.
    await waitFor(() => expect(screen.queryByText('Причина простоя')).toBeNull());
    expect(await screen.findByText('Проверьте итоги и закройте смену')).toBeInTheDocument();
  });

  it('попытка воспроизведения: черновик паспорта переживает «перезагрузку» со свежей пары', async () => {
    // Начало: экран приёмки, смены ещё нет.
    stateImpl = () => json({data: makeState({
      phase: 'ADMISSION',
      shift: null,
      options: [{crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'}],
    })});
    const first = render(<OperatorNextApp />);
    await screen.findByRole('button', {name: /Принять установку/});
    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));

    // Приёмка: смена создаётся по ходу сессии — дальше вся работа на «свежей» паре.
    const fresh = makeState({
      phase: 'WORK',
      shift: {id: 'shift-new', productionDate: '2026-10-03', startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), state: 'STARTED'},
    });
    stateImpl = () => json({data: fresh});
    fireEvent.click(screen.getByRole('button', {name: /Принять установку/}));
    await screen.findByText('Запишите результат работы');

    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'AC-QA-reload'}});
    fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
    fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
    const blows = screen.getAllByLabelText('Ударов');
    ['30', '32', '34'].forEach((v, i) => fireEvent.change(blows[i], {target: {value: v}}));
    const penetration = screen.getAllByLabelText(/^Погружение/);
    ['12', '9', '7'].forEach((v, i) => fireEvent.change(penetration[i], {target: {value: v}}));
    await waitFor(() => expect(globalThis.localStorage.getItem('piling.onx.drafts.v1:user-a:shift-new') ?? '').toContain('AC-QA-reload'));

    // «Перезагрузка страницы»: размонтирование и повторный вход.
    first.unmount();
    render(<OperatorNextApp />);
    expect(await screen.findByPlaceholderText('С-130')).toHaveValue('AC-QA-reload');
    expect(screen.getAllByLabelText('Ударов')).toHaveLength(3);
  });
});