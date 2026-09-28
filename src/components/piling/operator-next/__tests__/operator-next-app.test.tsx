import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {OperatorNextApp} from '../operator-next-app';
import {checklistView, makeState} from './fixtures';

/**
 * Сквозные сценарии оболочки: ревью №1 нашло здесь потерю ввода и гонки
 * состояния. Проверяем через настоящее приложение и настоящий клиент
 * `operator-mobile/api.ts` — подменяем только сеть (`fetch`). Так тест видит и
 * разбор ответа, и разметку ошибок.
 */
const STORAGE_KEY = 'pilingtrack.operator.queue.v1';

type Responder = (url: string) => Response | Promise<Response>;

function json(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

let stateImpl: Responder;
let commandImpl: (body: Record<string, unknown> | null) => Response | Promise<Response>;
let sent: Record<string, unknown>[];

beforeEach(() => {
  globalThis.localStorage?.clear();
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

function withEquipment(state: OperatorMobileState, equipmentId: string, equipmentName: string): OperatorMobileState {
  return {
    ...state,
    assignment: state.assignment ? {...state.assignment, equipmentId, equipmentName} : null,
  };
}

function queueEntry(clientCommandId: string) {
  return {
    ownerId: null,
    clientCommandId,
    label: 'Записать сваи',
    command: {command: 'log-production', clientCommandId},
    queuedAt: '2026-09-27T10:00:00.000Z',
    attempts: 0,
    state: 'PENDING',
    lastError: null,
  };
}

async function openPileForm() {
  await screen.findByText('Запишите результат работы');
  fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
  fireEvent.click(screen.getByRole('button', {name: /С 100\.30/}));
  fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '5'}});
}

describe('находка №1: ошибка перечитывания не уничтожает рабочий экран', () => {
  it('рабочий экран и выбор человека остаются, ошибка показана полосой', async () => {
    const state = makeState({
      phase: 'ADMISSION',
      options: [
        {crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'},
        {crewId: 'c2', equipmentId: 'eq-2', equipmentName: 'СУ-2', siteName: 'Объект Б'},
      ],
    });
    stateImpl = () => json({data: state});
    render(<OperatorNextApp />);

    await screen.findByRole('button', {name: /Принять установку/});
    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));
    expect(screen.getByRole('button', {name: /Ночная/})).toHaveAttribute('aria-pressed', 'true');

    // Следующее чтение падает: смена установки запускает запрос.
    stateImpl = () => json({error: 'Сервер не ответил'}, 500);
    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));

    await waitFor(() => expect(screen.getByTestId('error-strip')).toBeInTheDocument());
    // Полноэкранной ошибки нет — экран жив.
    expect(screen.queryByRole('heading', {name: 'Нет связи'})).toBeNull();
    // И выбор человека не потерян: экран не размонтировали.
    expect(screen.getByRole('button', {name: /Ночная/})).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('находка №4: применяется только ответ последнего запроса', () => {
  it('устаревший ответ на прежний выбор установки не затирает показанную', async () => {
    const base = makeState({
      phase: 'ADMISSION',
      options: [
        {crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'},
        {crewId: 'c2', equipmentId: 'eq-2', equipmentName: 'СУ-2', siteName: 'Объект Б'},
      ],
    });
    const stateA = withEquipment(base, 'eq-1', 'Основная СУ-1');
    const stateB = withEquipment(base, 'eq-2', 'Чужая СУ-9');
    const late = deferred<Response>();

    stateImpl = (url) => {
      if (url.includes('equipmentId=eq-2')) return late.promise;
      if (url.includes('equipmentId=eq-1')) return json({data: stateA});
      return json({data: stateA});
    };
    render(<OperatorNextApp />);
    await screen.findByRole('button', {name: /Принять установку/});

    // Выбрали Б, затем вернулись к А. Последним запрошен А.
    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));
    fireEvent.click(screen.getByRole('button', {name: /СУ-1/}));
    await waitFor(() => expect(screen.getByText('Основная СУ-1')).toBeInTheDocument());

    // Ответ на прежний выбор приходит позже — он не должен победить.
    late.resolve(json({data: stateB}));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Чужая СУ-9')).toBeNull();
    expect(screen.getByText('Основная СУ-1')).toBeInTheDocument();
  });
});

describe('находка №2: черновик переживает переходы', () => {
  it('вкладка, возврат и «Назад к смене» не стирают набранное', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    fireEvent.click(screen.getByRole('button', {name: 'Техника'}));
    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    expect(screen.getByRole('button', {name: /С 100\.30/})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(5);

    fireEvent.click(screen.getByRole('button', {name: /Назад к смене/}));
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(5);
  });

  it('заметка закрытия переживает переход на другую вкладку', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    const note = await screen.findByPlaceholderText(/осталось 4 сваи/i);
    fireEvent.change(note, {target: {value: 'завтра доделать ось Б'}});

    fireEvent.click(screen.getByRole('button', {name: 'Техника'}));
    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    expect(screen.getByPlaceholderText(/осталось 4 сваи/i)).toHaveValue('завтра доделать ось Б');
  });
});

describe('находка №3: поля закрыты, пока команда в пути', () => {
  it('во время отправки менять нечего, после успеха форма закрывается', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const pending = deferred<Response>();
    commandImpl = () => pending.promise;
    render(<OperatorNextApp />);
    await openPileForm();

    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toBeDisabled());
    expect(screen.getByRole('button', {name: /С 100\.30/})).toBeDisabled();

    pending.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
  });
});

describe('гарантия: двойное нажатие шлёт одну команду', () => {
  it('два нажатия подряд — одна отправка', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const pending = deferred<Response>();
    commandImpl = () => pending.promise;
    render(<OperatorNextApp />);
    await openPileForm();

    const button = screen.getByRole('button', {name: /^Записать/}) as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
    });

    expect(sent).toHaveLength(1);
    pending.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
  });
});

describe('гарантия: ключ команды обновляется только у той, что прошла', () => {
  it('отказ ключ не меняет, успех — меняет', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    commandImpl = () => json({error: 'Validation failed'}, 400);
    render(<OperatorNextApp />);
    await openPileForm();

    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent).toHaveLength(1));
    const key = sent[0].clientCommandId;

    // Повтор той же попытки: ключ обязан остаться прежним, иначе сервер
    // запишет ту же команду второй раз.
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].clientCommandId).toBe(key);

    // Прошло — ключ сменился.
    commandImpl = () => json({data: {ok: true}});
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent).toHaveLength(3));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());

    await openPileForm();
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent).toHaveLength(4));
    expect(sent[3].clientCommandId).not.toBe(key);
  });
});

describe('гарантия: принято, но перечитывание упало', () => {
  it('на экране «Записано», а не «Нет связи», форма очищена один раз', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    // Следующее чтение (уже после принятой записи) падает.
    stateImpl = () => json({error: 'Сеть недоступна'}, 500);
    commandImpl = () => json({data: {ok: true}});
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));

    await waitFor(() => expect(screen.getByTestId('notice-strip')).toHaveTextContent('Записано: сервер принял запись'));
    expect(screen.queryByRole('heading', {name: 'Нет связи'})).toBeNull();
    expect(screen.getByText('Запишите результат работы')).toBeInTheDocument();
    expect(sent).toHaveLength(1);
  });
});

describe('находка №7: ошибка инструктажа видна на его экране', () => {
  it('отказ показан с кнопкой «Повторить»', async () => {
    const identity = makeState().identity;
    stateImpl = () => json({
      data: makeState({
        phase: 'IDENTITY',
        identity: {...identity, briefing: {...identity.briefing, ok: false, acknowledgedAt: null}},
      }),
    });
    commandImpl = () => json({error: 'Validation failed'}, 400);
    render(<OperatorNextApp />);

    fireEvent.click(await screen.findByRole('button', {name: /Ознакомление с инструкциями/}));
    fireEvent.click(await screen.findByRole('button', {name: /Прочитал и ознакомлен/}));

    await waitFor(() => expect(screen.getByTestId('error-strip')).toHaveTextContent(/Сервер не принял данные/));
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });
});

describe('гарантия: закрытие перечитывает очередь перед close-shift', () => {
  const closing = () => makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]});

  it('запись, появившаяся после отрисовки, закрытию не даёт пройти', async () => {
    stateImpl = () => json({data: closing()});
    // Отправка из очереди не проходит: запись остаётся на устройстве.
    commandImpl = (body) => (body && body.clientCommandId
      ? json({error: 'Сервер занят'}, 503)
      : json({data: {ok: true}}));
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    // Другая вкладка (или фоновая отправка) положила запись — экран об этом не знает.
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-1')]));

    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    await waitFor(() => expect(screen.getAllByText(/На устройстве 1 неотправленных записей/).length).toBeGreaterThan(0));
    expect(sent.some((body) => body.command === 'close-shift')).toBe(false);
  });

  it('с пустой очередью смена закрывается', async () => {
    stateImpl = () => json({data: closing()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    await waitFor(() => expect(sent.some((body) => body.command === 'close-shift')).toBe(true));
  });
});
