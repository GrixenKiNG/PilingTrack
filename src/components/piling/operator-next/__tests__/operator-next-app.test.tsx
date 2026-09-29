import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {usePilingStore} from '@/lib/store';
import {OperatorNextApp} from '../operator-next-app';
import {draftStorageKey, saveShellDrafts} from '../draft-storage';
import {emptyFormFields, emptyPassportDraft, emptyWorkDraft} from '../drafts';
import {checklistView, makeChecklist, makeState} from './fixtures';
import {flushQueue} from '@/components/piling/operator-mobile/offline-queue';

// Считаем вызовы самого flush (ревью №5, B5): «одна отправка элемента очереди»
// ещё не доказывает, что подготовка была одна, — нужен счётчик непосредственно
// на flush. Шпион оборачивает настоящую отправку, поведение не меняется.
vi.mock('@/components/piling/operator-mobile/offline-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/piling/operator-mobile/offline-queue')>();
  return {...actual, flushQueue: vi.fn(actual.flushQueue)};
});

/**
 * Сквозные сценарии оболочки: ревью №1 нашло здесь потерю ввода и гонки
 * состояния. Проверяем через настоящее приложение и настоящий клиент
 * `operator-mobile/api.ts` — подменяем только сеть (`fetch`). Так тест видит и
 * разбор ответа, и разметку ошибок.
 */
const STORAGE_KEY = 'pilingtrack.operator.queue.v1';

type Responder = (url: string) => Response | Promise<Response>;

/** По умолчанию в тестах — конкретный вошедший: без него черновики не хранятся. */
const DEFAULT_USER = {id: 'user-a', email: 'user-a@piling.test', name: 'Машинист А', role: 'OPERATOR' as const};

/** Второй машинист — для смены пользователя на общем планшете. */
const USER_B = {id: 'user-b', email: 'user-b@piling.test', name: 'Машинист Б', role: 'OPERATOR' as const};

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
  // Черновики хранятся по паре «пользователь + смена»: между тестами ставим
  // конкретного машиниста — с неизвестным пользователем хранилище не работает.
  usePilingStore.setState({currentUser: DEFAULT_USER});
  sent = [];
  vi.mocked(flushQueue).mockClear();
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

describe('ревью №4, B4: второе нажатие во время отправки — одна команда', () => {
  it('происшествие: двойное нажатие в одном такте — одна отправка', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: 'Ещё'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Записать происшествие'}));
    fireEvent.click(screen.getByRole('button', {name: /Рабочая зона/}));
    fireEvent.click(screen.getByRole('button', {name: 'Утечка'}));
    fireEvent.change(screen.getByLabelText('Как было дело'), {target: {value: 'Разлив масла у насосной'}});

    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    const submit = screen.getByRole('button', {name: /^Записать происшествие$/}) as HTMLButtonElement;
    await act(async () => {
      submit.click();
      submit.click();
    });
    expect(sent.filter((item) => item.command === 'report-incident')).toHaveLength(1);
    gate.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.queryByLabelText('Как было дело')).toBeNull());
  });

  it('поправка: двойное нажатие в одном такте — одна отправка', async () => {
    const entries = () => [{
      id: 'e1', kind: 'PILES' as const, label: 'С 100.30 · 5 шт', value: 5, meters: 15,
      occurredAt: '2026-09-27T05:00:00.000Z', corrections: [],
    }];
    stateImpl = () => json({data: makeState({phase: 'WORK', entries: entries()})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    fireEvent.change(screen.getByLabelText(/Сколько свай было на самом деле/), {target: {value: '6'}});
    fireEvent.change(screen.getByLabelText('Что случилось'), {target: {value: 'Ошибся при вводе'}});

    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    const submit = screen.getByRole('button', {name: /Записать поправку/}) as HTMLButtonElement;
    await act(async () => {
      submit.click();
      submit.click();
    });
    expect(sent.filter((item) => item.command === 'correct-production')).toHaveLength(1);
    gate.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.queryByLabelText(/Сколько свай было на самом деле/)).toBeNull());
  });

  it('запись в очередь: двойное нажатие при обрыве — ровно одна запись', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();
    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    const submit = screen.getByRole('button', {name: /^Записать/}) as HTMLButtonElement;
    await act(async () => {
      submit.click();
      submit.click();
    });
    gate.reject(new TypeError('network down'));
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored).toHaveLength(1);
    expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1);
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

    // «Повторить» повторяет именно подтверждение инструктажа (ревью №2, п.8).
    commandImpl = () => json({data: {ok: true}});
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toMatchObject({command: 'acknowledge-briefing'});
    expect(sent[1]).toMatchObject({command: 'acknowledge-briefing'});
  });
});

describe('находка Д4: отказ по роли не тупик', () => {
  it('есть «Обновить», и успешное чтение снимает экран отказа', async () => {
    let denied = true;
    stateImpl = () => (denied
      ? json({error: 'Forbidden'}, 403)
      : json({data: makeState({phase: 'ADMISSION'})}));
    render(<OperatorNextApp />);

    expect(await screen.findByText(/Это действие вам недоступно/)).toBeInTheDocument();
    denied = false;
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));
    expect(await screen.findByRole('button', {name: /Принять установку/})).toBeInTheDocument();
  });
});

describe('находка Д3: установка не выбрана за человека', () => {
  it('при нескольких установках приёмка ждёт касания, и в команду уходит выбранная', async () => {
    const base = makeState({
      phase: 'ADMISSION',
      options: [
        {crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'},
        {crewId: 'c2', equipmentId: 'eq-2', equipmentName: 'СУ-2', siteName: 'Объект Б'},
      ],
    });
    stateImpl = (url) => (url.includes('equipmentId=eq-2')
      ? json({data: withEquipment(base, 'eq-2', 'СУ-2')})
      : json({data: withEquipment(base, 'eq-1', 'СУ-1')}));
    render(<OperatorNextApp />);

    await screen.findByRole('button', {name: /Принять установку/});
    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));
    expect(screen.getByRole('button', {name: /Принять установку/})).toBeDisabled();
    expect(screen.getByText('Сначала выберите установку.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));
    const accept = await screen.findByRole('button', {name: /Принять установку/});
    await waitFor(() => expect(accept).not.toBeDisabled());
    fireEvent.click(accept);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({command: 'accept-equipment', equipmentId: 'eq-2', shiftType: 'NIGHT'});
  });
});

describe('находка Д8: следующий шаг не прячется за вкладкой', () => {
  it('при переходе фазы в закрытие показывается вкладка «Смена»', async () => {
    let phase: 'WORK' | 'CLOSING' = 'WORK';
    stateImpl = () => json({data: makeState({phase, checklists: [checklistView('EO_AFTER', true)]})});
    commandImpl = () => json({data: {ok: true}});
    render(<OperatorNextApp />);

    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: 'Техника'}));
    expect(screen.getByRole('heading', {name: 'Техника'})).toBeInTheDocument();

    // Смена ушла в закрытие (например, работу завершили с другого устройства),
    // а экран перечитает состояние по появлению связи.
    phase = 'CLOSING';
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-9')]));
    await act(async () => {
      globalThis.dispatchEvent(new Event('online'));
    });

    expect(await screen.findByText('Проверьте итоги и закройте смену')).toBeInTheDocument();
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

describe('ревью №2, п.1: подтверждение, очистка и разблокировка — один цикл', () => {
  it('после подтверждения поля пусты и закрыты до конца перечитывания; повтор не отправляет', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    // Команда пройдёт сразу, а перечитывание «зависнет».
    const slowReload = deferred<Response>();
    let delayReads = false;
    stateImpl = () => (delayReads ? slowReload.promise : json({data: makeState({phase: 'WORK'})}));
    delayReads = true;

    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent).toHaveLength(1));

    // Поля уже очищены и всё ещё закрыты: цикл не закончился.
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toBeDisabled());
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(null);

    // Второе нажатие во время перечитывания не шлёт вторую команду.
    const again = screen.getByRole('button', {name: /Записываем/});
    expect(again).toBeDisabled();
    fireEvent.click(again);
    await act(async () => { await Promise.resolve(); });
    expect(sent).toHaveLength(1);

    // Перечитывание завершилось — форма закрылась сама.
    slowReload.resolve(json({data: makeState({phase: 'WORK'})}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
  });
});

describe('ревью №2, п.2: подготовка закрытия смены — под замком', () => {
  it('во время подготовки заметка редактируема, повтор не запускает вторую подготовку', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    // Запись на устройстве, отправка которой «зависнет».
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-1')]));
    const slowSend = deferred<Response>();
    commandImpl = (body) => (body && body.command === 'log-production' ? slowSend.promise : json({data: {ok: true}}));

    const flushBefore = vi.mocked(flushQueue).mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    // Подготовка началась: запись из очереди ушла в отправку.
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));

    // Заметку можно менять во время подготовки (ревью №4, B5): в команду уйдёт
    // актуальный текст, а не снимок на момент нажатия.
    const note = screen.getByPlaceholderText(/осталось 4 сваи/i);
    expect(note).not.toBeDisabled();
    fireEvent.change(note, {target: {value: 'вывезти грунт к 19:00'}});

    // Повторное нажатие ничего не запускает: подготовка одна.
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    await act(async () => { await Promise.resolve(); });
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(0);

    // Подготовка закончилась: смена закрывается ОДНОЙ командой с новой заметкой.
    slowSend.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(sent.some((item) => item.command === 'close-shift')).toBe(true));
    const closeBody = sent.find((item) => item.command === 'close-shift') as {comment?: string};
    expect(closeBody.comment).toBe('вывезти грунт к 19:00');
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(1);
    // Двойное нажатие не запустило вторую подготовку: сам flush вызван один раз.
    expect(vi.mocked(flushQueue).mock.calls.length - flushBefore).toBe(1);
  });
});

describe('ревью №2, п.3: вкладки в закрытии смены работают', () => {
  it('«Техника» реально открывается, заметка переживает возврат', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    fireEvent.change(screen.getByPlaceholderText(/осталось 4 сваи/i), {target: {value: 'завтра доделать ось Б'}});
    fireEvent.click(screen.getByRole('button', {name: 'Техника'}));
    expect(await screen.findByRole('heading', {name: 'Техника'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    expect(await screen.findByPlaceholderText(/осталось 4 сваи/i)).toHaveValue('завтра доделать ось Б');
  });
});

describe('ревью №2, п.4: отправленная заметка закрытия не остаётся черновиком', () => {
  it('закрытие принято, чтение упало — заметки нет, повторно её отправить нечем', async () => {
    let stateReadsFail = false;
    stateImpl = () => (stateReadsFail
      ? json({error: 'Сеть недоступна'}, 500)
      : json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})}));
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');
    fireEvent.change(screen.getByPlaceholderText(/осталось 4 сваи/i), {target: {value: 'вывезти грунт'}});

    commandImpl = (body) => {
      if (body && body.command === 'close-shift') stateReadsFail = true;
      return json({data: {ok: true}});
    };
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    await waitFor(() => expect(screen.getByTestId('notice-strip')).toHaveTextContent('Записано: сервер принял запись'));
    // Заметка очищена, повторно её отправить нечем.
    expect(screen.getByPlaceholderText(/осталось 4 сваи/i)).toHaveValue('');
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(1);
  });
});

describe('ревью №2, п.5: черновики переживают переходы', () => {
  it('ответы обходного осмотра переживают «Назад» и повторное открытие', async () => {
    stateImpl = () => json({data: makeState({
      phase: 'WORK',
      checklists: [makeChecklist({stage: 'TB_PILING', title: 'ТБ: забивка свай'}), checklistView('TB_DRILLING', true)],
    })});
    render(<OperatorNextApp />);

    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    fireEvent.click(await screen.findByRole('button', {name: /Пройти чек-лист ТБ/}));

    const level = await screen.findByTestId('inspection-item-i-level');
    fireEvent.click(within(level).getByRole('button', {name: 'Норма'}));
    expect(within(level).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'true');

    // У обходного осмотра выход — «Назад», а не «Отложить осмотр».
    expect(screen.queryByRole('button', {name: /Отложить осмотр/})).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Назад'}));
    fireEvent.click(await screen.findByRole('button', {name: /Пройти чек-лист ТБ/}));

    const levelAgain = await screen.findByTestId('inspection-item-i-level');
    expect(within(levelAgain).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'true');
  });

  it('уход на вкладку ТБ и возврат сохраняют черновик работы', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    fireEvent.click(screen.getByRole('button', {name: 'ТБ'}));
    expect(await screen.findByText(/Все шаги пройдены|Осталось шагов/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    expect(screen.getByRole('button', {name: /С 100\.30/})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(5);
  });

  it('черновик паспорта сваи переживает «Назад к смене» и возврат', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');

    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    const numberField = await screen.findByPlaceholderText('С-130');
    fireEvent.change(numberField, {target: {value: 'С-201'}});

    fireEvent.click(screen.getAllByRole('button', {name: 'Назад к смене'})[0]);
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    expect(await screen.findByPlaceholderText('С-130')).toHaveValue('С-201');
  });
});

describe('ревью №4, B6: гонка установок — два запроса и раздельно управляемые ответы', () => {
  it('устаревший ответ отброшен; приёмка отправляет последнюю выбранную', async () => {
    const base = makeState({
      phase: 'ADMISSION',
      options: [
        {crewId: 'c1', equipmentId: 'eq-1', equipmentName: 'СУ-1', siteName: 'Объект А'},
        {crewId: 'c2', equipmentId: 'eq-2', equipmentName: 'СУ-2', siteName: 'Объект Б'},
      ],
    });
    const stateA = withEquipment(base, 'eq-1', 'Основная СУ-1');
    const stateB = withEquipment(base, 'eq-2', 'Чужая СУ-9');
    const answerB = deferred<Response>();
    const answerA = deferred<Response>();
    const reads: string[] = [];
    stateImpl = (url) => {
      reads.push(url);
      if (url.includes('equipmentId=eq-2')) return answerB.promise;
      if (url.includes('equipmentId=eq-1')) return answerA.promise;
      return json({data: stateA});
    };

    render(<OperatorNextApp />);
    await screen.findByRole('button', {name: /Принять установку/});
    const initialReads = reads.length;

    // Первый выбор: запрос Б уходит и «висит» — как в бою до ответа сервера.
    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));
    await waitFor(() => expect(reads.filter((u) => u.includes('eq-2')).length).toBe(1));

    // Второй выбор вызываем у обработчика строки НАПРЯМУЮ (ревью №4, B6):
    // нативная блокировка на время загрузки не пускает второе нажатие человека,
    // а гонку двух чтений нужно воспроизвести — оба запроса должны быть реально
    // начаты после точки отсчёта.
    const rowA = screen.getByRole('button', {name: /СУ-1/});
    const propsKey = Object.keys(rowA).find((key) => key.startsWith('__reactProps'));
    if (!propsKey) throw new Error('не найден React-обработчик строки выбора');
    const rowProps = (rowA as unknown as Record<string, {onClick?: () => void}>)[propsKey];
    if (!rowProps?.onClick) throw new Error('у строки выбора нет onClick');
    await act(async () => { rowProps.onClick?.(); });

    // Ровно +2 новых запроса: по одному на каждый выбор.
    await waitFor(() => expect(reads.length).toBe(initialReads + 2));
    expect(reads.filter((u) => u.includes('eq-1')).length).toBe(1);
    // Второй выбор действительно применён — иначе и гонки нет.
    await waitFor(() => expect(screen.getByRole('button', {name: /СУ-1/})).toHaveAttribute('aria-pressed', 'true'));

    // Ответы приходят в обратном порядке: свежий (А) раньше, устаревший (Б) позже.
    answerA.resolve(json({data: stateA}));
    await waitFor(() => expect(screen.getByText('Основная СУ-1')).toBeInTheDocument());
    answerB.resolve(json({data: stateB}));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('Чужая СУ-9')).toBeNull();
    expect(screen.getByText('Основная СУ-1')).toBeInTheDocument();

    // Приёмка отправляет последнюю выбранную установку.
    fireEvent.click(screen.getByRole('button', {name: /Ночная/}));
    const accept = screen.getByRole('button', {name: /Принять установку/});
    await waitFor(() => expect(accept).not.toBeDisabled());
    fireEvent.click(accept);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({command: 'accept-equipment', equipmentId: 'eq-1', shiftType: 'NIGHT'});
  });
});

describe('ревью №2, п.9: обход в отсутствующий чек-лист не тупик', () => {
  it('сказано, что списка нет; «Обновить» и «Назад к смене» работают', async () => {
    let servicePresent = true;
    let reads = 0;
    stateImpl = () => {
      reads += 1;
      return json({data: makeState({
        phase: 'CLOSING',
        checklists: servicePresent ? [checklistView('EO_AFTER', false)] : [],
      })});
    };
    render(<OperatorNextApp />);

    fireEvent.click(await screen.findByRole('button', {name: /Выполнить осмотр после работы/}));
    // Пока осмотр открыт, сервер перестал отдавать этот список.
    servicePresent = false;
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-9')]));
    await act(async () => { globalThis.dispatchEvent(new Event('online')); });

    expect(await screen.findByText(/Сервер не отдал этот чек-лист/)).toBeInTheDocument();
    // «Обновить» действительно спрашивает сервер заново (ревью №3, п.6).
    const before = reads;
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));
    await waitFor(() => expect(reads).toBeGreaterThan(before));

    // Список восстановился — вместо заглушки показывается сам осмотр.
    servicePresent = true;
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));
    expect(await screen.findByTestId('inspection-counter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Назад'}));
    expect(await screen.findByText('Выполнить осмотр после работы')).toBeInTheDocument();
  });
});

describe('ревью №2, п.10: ключ обновляется только у своего вида', () => {
  const tbState = () => makeState({
    phase: 'WORK',
    checklists: [makeChecklist({stage: 'TB_PILING', title: 'ТБ: забивка свай'}), checklistView('TB_DRILLING', true)],
  });

  async function submitTbChecklist() {
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    fireEvent.click(await screen.findByRole('button', {name: /Пройти чек-лист ТБ/}));
    const level = await screen.findByTestId('inspection-item-i-level');
    fireEvent.click(within(level).getByRole('button', {name: 'Норма'}));
    const leak = screen.getByTestId('inspection-item-i-leak');
    fireEvent.click(within(leak).getByRole('button', {name: 'Норма'}));
    fireEvent.click(screen.getByRole('button', {name: /Завершить осмотр/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'submit-checklist')).toBe(true));
  }

  it('успех выработки не меняет ключ осмотра; своя команда ключ обновляет', async () => {
    stateImpl = () => json({data: tbState()});
    commandImpl = () => json({error: 'Validation failed'}, 400);
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');

    // Осмотр отклонён — ключ вида «checklist» зафиксирован.
    await submitTbChecklist();
    const checklistKey = sent[sent.length - 1].clientCommandId;
    fireEvent.click(screen.getByRole('button', {name: 'Назад'}));

    // Успешная запись простоя — успех СОСЕДНЕГО вида.
    commandImpl = () => json({data: {ok: true}});
    fireEvent.click(screen.getByRole('button', {name: /Назад к смене/}));
    fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
    fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1));
    const productionKey = sent[sent.length - 1].clientCommandId;
    await screen.findByText('Запишите результат работы');

    // Осмотр снова: ключ не изменился от чужого успеха.
    await submitTbChecklist();
    expect(sent[sent.length - 1].clientCommandId).toBe(checklistKey);

    // Своя команда ключ обновила: следующая отправка простоя — с новым ключом.
    fireEvent.click(screen.getByRole('button', {name: /Назад к смене/}));
    fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
    fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(2));
    expect(sent[sent.length - 1].clientCommandId).not.toBe(productionKey);
  });

  it('ветка «легло в очередь»: соседний ключ не тронут, свой — обновлён', async () => {
    stateImpl = () => json({data: tbState()});
    commandImpl = () => json({error: 'Validation failed'}, 400);
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');

    await submitTbChecklist();
    const checklistKey = sent[sent.length - 1].clientCommandId;
    fireEvent.click(screen.getByRole('button', {name: 'Назад'}));

    // Сеть пропала: выработка ложится в очередь (ветка QueuedOffline).
    commandImpl = () => { throw new TypeError('network down'); };
    fireEvent.click(screen.getByRole('button', {name: /Назад к смене/}));
    fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
    fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
    const queuedKey = sent[sent.length - 1].clientCommandId;
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '[]') as {
      clientCommandId: string; command?: {command?: string};
    }[];
    expect(stored.find((item) => item.command?.command === 'log-production')?.clientCommandId).toBe(queuedKey);

    // Следующая запись простоя — при связи — идёт с НОВЫМ ключом.
    commandImpl = () => json({data: {ok: true}});
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Записать простой/}));
    fireEvent.click(screen.getByRole('button', {name: /Ожидание бетона/}));
    fireEvent.click(screen.getByRole('button', {name: /Простой за последние 30 минут/}));
    fireEvent.click(screen.getByRole('button', {name: /^Записать$/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(2));
    expect(sent[sent.length - 1].clientCommandId).not.toBe(queuedKey);

    // Осмотр после очереди: ключ осмотра не менялся от чужой ветки.
    await submitTbChecklist();
    expect(sent[sent.length - 1].clientCommandId).toBe(checklistKey);
  });
});

describe('ревью №2, п.11: очередь не прочитана ≠ пусто; считаются только свои', () => {
  const closingState = () => makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]});

  it('испорченное хранилище держит закрытие понятным текстом', async () => {
    stateImpl = () => json({data: closingState()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    globalThis.localStorage.setItem(STORAGE_KEY, '{испорчено');
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    await waitFor(() => expect(screen.getAllByText(/Не удалось проверить очередь на устройстве/).length).toBeGreaterThan(0));
    expect(sent.some((item) => item.command === 'close-shift')).toBe(false);
  });

  it('чужая запись не считается своей и не отправляется от вошедшего', async () => {
    stateImpl = () => json({data: closingState()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      queueEntry('own-1'),
      {...queueEntry('foreign-1'), ownerId: 'other-user'},
    ]));
    commandImpl = (body) => (body && body.clientCommandId === 'own-1'
      ? json({error: 'Сервер занят'}, 503)
      : json({data: {ok: true}}));

    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    await waitFor(() => expect(screen.getAllByText(/На устройстве 1 неотправленных записей/).length).toBeGreaterThan(0));
    expect(sent.some((item) => item.command === 'close-shift')).toBe(false);
    expect(sent.filter((item) => item.clientCommandId === 'foreign-1')).toHaveLength(0);
  });
});

describe('ревью №2, C и находка Д1: осмотр откладывается без тупика', () => {
  it('«Отложить осмотр»: ответы целы, вкладки доступны, карточка ведёт обратно', async () => {
    stateImpl = () => json({data: makeState({phase: 'PRESHIFT_INSPECTION', checklists: [makeChecklist()]})});
    render(<OperatorNextApp />);

    const level = await screen.findByTestId('inspection-item-i-level');
    fireEvent.click(within(level).getByRole('button', {name: 'Норма'}));
    // Посреди осмотра вкладок нет: уйти «не заметив» нельзя.
    expect(screen.queryByRole('button', {name: 'Техника'})).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: /Отложить осмотр/}));

    // Вернулись к смене: вкладки доступны, «Следующее действие» зовёт обратно.
    expect(await screen.findByRole('button', {name: 'Продолжить осмотр'})).toBeInTheDocument();
    expect(screen.getByText('Допуск к работе не выдан')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Техника'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Техника'}));
    expect(await screen.findByRole('heading', {name: 'Техника'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));

    // Возврат к осмотру: отмеченное на месте.
    fireEvent.click(await screen.findByRole('button', {name: 'Продолжить осмотр'}));
    const levelAgain = await screen.findByTestId('inspection-item-i-level');
    expect(within(levelAgain).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'true');
  });

  it('без связи сообщение честно говорит про устройство и связь', async () => {
    stateImpl = () => json({data: makeState({phase: 'PRESHIFT_INSPECTION', checklists: [makeChecklist()]})});
    render(<OperatorNextApp />);
    await screen.findByTestId('inspection-item-i-level');

    Object.defineProperty(globalThis.navigator, 'onLine', {value: false, configurable: true});
    await act(async () => { globalThis.dispatchEvent(new Event('offline')); });

    fireEvent.click(screen.getByRole('button', {name: /Отложить осмотр/}));
    expect(await screen.findByText(/Осмотр сохранён на устройстве, отправить можно, когда появится связь/)).toBeInTheDocument();
  });
});

describe('ревью №3, п.1: поздняя загрузка чужой смены не трогает черновики', () => {
  it('фото смены А догрузилось после перехода к смене Б — черновики Б целы', async () => {
    const shiftOne = () => makeState({
      phase: 'WORK',
      checklists: [makeChecklist({stage: 'TB_PILING', title: 'ТБ: забивка свай'}), checklistView('TB_DRILLING', true)],
    });
    stateImpl = () => json({data: shiftOne()});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');

    // Смена А: открываем осмотр ТБ и запускаем загрузку снимка к неисправности.
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    fireEvent.click(await screen.findByRole('button', {name: /Пройти чек-лист ТБ/}));
    const leak = await screen.findByTestId('inspection-item-i-leak');
    fireEvent.click(within(leak).getByRole('button', {name: 'Неисправность'}));

    // Медиа-цепочка под нашим контролем: подтверждение загрузки «висит».
    const baseFetch = globalThis.fetch as unknown as (input: unknown, init?: RequestInit) => Promise<Response>;
    const mediaGate = deferred<void>();
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/media') return json({mediaId: 'm-late', uploadUrl: 'https://media.test/put/m-late'});
      if (url === 'https://media.test/put/m-late') {
        await mediaGate.promise;
        return json({ok: true});
      }
      if (url === '/api/media/m-late/confirm') return json({ok: true});
      return baseFetch(input, init);
    }) as unknown as typeof fetch;

    const fileInput = leak.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {value: [new File(['a'], 'a.jpg', {type: 'image/jpeg'})], configurable: true});
    fireEvent.change(fileInput);

    // Пока загрузка висит, оболочка переходит к смене Б (перечитывание по связи).
    stateImpl = () => json({data: makeState({
      phase: 'WORK',
      shift: {id: 'shift-2', productionDate: '2026-09-27', startedAt: '2026-09-27T04:00:00.000Z', state: 'OPEN'},
      checklists: [makeChecklist({stage: 'TB_PILING', title: 'ТБ: забивка свай'}), checklistView('TB_DRILLING', true)],
    })});
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-switch')]));
    await act(async () => { globalThis.dispatchEvent(new Event('online')); });

    // На смене Б: закрываем осмотр и заводим свой черновик — число 7.
    fireEvent.click(await screen.findByRole('button', {name: 'Назад'}));
    fireEvent.click(screen.getAllByRole('button', {name: /Записать сваи/})[0]);
    fireEvent.click(screen.getByRole('button', {name: /С 100\.30/}));
    fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '7'}});

    // Поздняя загрузка завершается: её обработчик остался от смены А.
    await act(async () => {
      mediaGate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Черновики Б не изменились.
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(7);
    fireEvent.click(screen.getByRole('button', {name: /Пройти чек-лист ТБ/}));
    const levelB = await screen.findByTestId('inspection-item-i-level');
    expect(within(levelB).getByRole('button', {name: 'Норма'})).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/Снимков приложено/)).toBeNull();
  });
});

describe('ревью №3, п.2: паспорт сваи — черновик, блокировка, очистка', () => {
  it('переход в обходной экран и обратно — паспорт на месте', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByPlaceholderText('С-130'), {target: {value: 'С-301'}});

    // Обходной экран (инструктаж) размонтирует экран работы — черновик должен вернуться.
    fireEvent.click(screen.getByRole('button', {name: 'ТБ'}));
    fireEvent.click(await screen.findByRole('button', {name: /Ознакомление с инструкциями/}));
    fireEvent.click(await screen.findByRole('button', {name: 'Назад'}));
    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    expect(await screen.findByPlaceholderText('С-130')).toHaveValue('С-301');
  });

  it('черновик паспорта переживает перезагрузку страницы', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const first = render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByPlaceholderText('С-130'), {target: {value: 'С-402'}});
    // Черновик оседает в хранилище сразу по вводу.
    const snapshot = globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string);
    expect(snapshot ?? '').toContain('С-402');
    first.unmount();

    render(<OperatorNextApp />);
    await waitFor(() => expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-402'));
  });

  it('подтверждённый паспорт очищается сразу, до перечитывания; поля закрыты', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-77'}});

    const slowReload = deferred<Response>();
    let delayReads = false;
    stateImpl = () => (delayReads ? slowReload.promise : json({data: makeState({phase: 'WORK'})}));
    delayReads = true;

    fireEvent.click(screen.getByRole('button', {name: /Записать сваю с паспортом/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
    // до перечитывания: отправленная строка уже очищена (память оболочки), поля закрыты
    await waitFor(() => expect(screen.getByPlaceholderText('С-130')).toHaveValue(''));
    expect(screen.getByPlaceholderText('С-130')).toBeDisabled();
    const again = screen.queryByRole('button', {name: /Записываем/});
    if (again) {
      fireEvent.click(again);
      await act(async () => { await Promise.resolve(); });
    }
    expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1);

    slowReload.resolve(json({data: makeState({phase: 'WORK'})}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());

    // После разблокировки новый ввод цел: поздние продолжения отправки не стирают его.
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    await waitFor(() => expect(screen.getByPlaceholderText('С-130')).not.toBeDisabled());
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-999'}});
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-999');
    // «Константы проекта» остались для следующей сваи.
    expect(screen.getByLabelText('Марка сваи')).toHaveValue('g1');

    // В хранилище отправленного нет: «С-77» не воскреснет при перезагрузке.
    const raw = globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string);
    expect(raw ?? '').not.toContain('С-77');
  });

  it('паспорт с тремя залогами переживает обходной экран и при отключённом localStorage', async () => {
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      stateImpl = () => json({data: makeState({phase: 'WORK'})});
      render(<OperatorNextApp />);
      await screen.findByText('Запишите результат работы');
      fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
      fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g2'}});
      fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-555'}});
      fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
      fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
      const blows = screen.getAllByLabelText('Ударов');
      const penetration = screen.getAllByLabelText(/^Погружение/);
      expect(blows).toHaveLength(3);
      ['30', '32', '34'].forEach((v, i) => fireEvent.change(blows[i], {target: {value: v}}));
      ['12', '9', '7'].forEach((v, i) => fireEvent.change(penetration[i], {target: {value: v}}));

      // Обходной экран размонтирует работу — паспорт должен вернуться целиком.
      fireEvent.click(screen.getByRole('button', {name: 'ТБ'}));
      fireEvent.click(await screen.findByRole('button', {name: /Ознакомление с инструкциями/}));
      fireEvent.click(await screen.findByRole('button', {name: 'Назад'}));
      fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
      // Форма паспорта никуда не девалась: режим остался «паспорт», и после
      // возврата на «Смену» видно её же — с полным черновиком.
      expect(await screen.findByPlaceholderText('С-130')).toHaveValue('С-555');
      const blowsBack = screen.getAllByLabelText('Ударов');
      expect(blowsBack).toHaveLength(3);
      expect(blowsBack[0]).toHaveValue(30);
      expect(blowsBack[2]).toHaveValue(34);
      const penBack = screen.getAllByLabelText(/^Погружение/);
      expect(penBack[1]).toHaveValue(9);
      // Честный статус на экране формы: при перезагрузке не сохранится.
      expect(screen.getByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();
    } finally {
      setSpy.mockRestore();
    }
  });

  it('отправленный паспорт после восстановления содержит все три залога', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const first = render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-777'}});
    fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
    fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
    const blows = screen.getAllByLabelText('Ударов');
    const penetration = screen.getAllByLabelText(/^Погружение/);
    ['30', '31', '32'].forEach((v, i) => fireEvent.change(blows[i], {target: {value: v}}));
    ['12', '10', '8'].forEach((v, i) => fireEvent.change(penetration[i], {target: {value: v}}));
    first.unmount();

    // «Перезагрузка»: черновик поднялся из хранилища — вместе с открытой формой
    // паспорта (режим формы — часть черновика), со всеми тремя залогами.
    render(<OperatorNextApp />);
    expect(await screen.findByPlaceholderText('С-130')).toHaveValue('С-777');
    expect(screen.getAllByLabelText('Ударов')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', {name: /Записать сваю с паспортом/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
    const body = sent.find((item) => item.command === 'log-production') as {
      entry: {passport: {sets: {blows: number; penetrationMm: number}[]}};
    };
    expect(body.entry.passport.sets).toHaveLength(3);
    expect(body.entry.passport.sets[0]).toMatchObject({blows: 30});
    expect(body.entry.passport.sets[2]).toMatchObject({blows: 32, penetrationMm: 8});
  });
});

describe('ревью №4, B4: позднее продолжение отправки не стирает новое', () => {
  it('выработка: «reload» упал — очистка уже сделана, новый ввод цел', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    const slowReload = deferred<Response>();
    let delayReads = false;
    stateImpl = () => (delayReads ? slowReload.promise : json({data: makeState({phase: 'WORK'})}));
    delayReads = true;

    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1));
    // Подтверждение очистило поля сразу — перечитывание ещё идёт, форма
    // закрывается по концу цикла (ревью №2), а не по подтверждению.
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(null));

    // Перечитывание падает — введённое заново не стирается поздним продолжением.
    slowReload.resolve(json({error: 'Сеть недоступна'}, 500));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
    await openPileForm();
    fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '9'}});
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(9);
    expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1);
  });

  it('выработка: «reload» завершился сразу — новый ввод цел', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
    await openPileForm();
    fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '9'}});
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(9);
  });
});

describe('ревью №3, п.3: единый цикл для очереди, происшествия и поправки', () => {
  const correctionEntries = () => [{
    id: 'e1', kind: 'PILES' as const, label: 'С 100.30 · 5 шт', value: 5, meters: 15,
    occurredAt: '2026-09-27T05:00:00.000Z', corrections: [],
  }];

  it('ветка очереди: блокировка до подтверждения, очистка и единственная отправка', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();

    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    // Пока команда в пути — поля закрыты, но ещё заполнены: очистка по подтверждению.
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toBeDisabled());
    expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(5);

    // Обрыв: запись легла в очередь.
    gate.reject(new TypeError('network down'));
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown[];
    expect(stored).toHaveLength(1);
    expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1);
  });

  it('происшествие: форма закрывается по подтверждению, отправка одна', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: 'Ещё'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Записать происшествие'}));
    fireEvent.click(screen.getByRole('button', {name: /Рабочая зона/}));
    fireEvent.click(screen.getByRole('button', {name: 'Утечка'}));
    fireEvent.change(screen.getByLabelText('Как было дело'), {target: {value: 'Разлив масла у насосной'}});

    // Команда «зависает»: поля обязаны быть закрыты (затвор вокруг формы).
    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    fireEvent.click(screen.getByRole('button', {name: /^Записать происшествие$/}));
    await waitFor(() => expect(screen.getByLabelText('Как было дело')).toBeDisabled());

    // Перечитывание — отдельный шаг; форма закрывается и очищается по подтверждению.
    const slowReload = deferred<Response>();
    let delayReads = false;
    stateImpl = () => (delayReads ? slowReload.promise : json({data: makeState({phase: 'WORK'})}));
    delayReads = true;
    gate.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.queryByLabelText('Как было дело')).toBeNull());
    expect(sent.filter((item) => item.command === 'report-incident')).toHaveLength(1);
    slowReload.resolve(json({data: makeState({phase: 'WORK'})}));
    await waitFor(() => expect(screen.getByRole('button', {name: 'Записать происшествие'})).toBeInTheDocument());
  });

  it('поправка: форма закрывается по подтверждению, отправка одна', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK', entries: correctionEntries()})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    fireEvent.change(screen.getByLabelText(/Сколько свай было на самом деле/), {target: {value: '6'}});
    fireEvent.change(screen.getByLabelText('Что случилось'), {target: {value: 'Ошибся при вводе'}});

    // Команда «зависает»: поля закрыты, пока идёт отправка.
    const gate = deferred<Response>();
    commandImpl = () => gate.promise;
    fireEvent.click(screen.getByRole('button', {name: /Записать поправку/}));
    await waitFor(() => expect(screen.getByLabelText(/Сколько свай было на самом деле/)).toBeDisabled());

    const slowReload = deferred<Response>();
    let delayReads = false;
    stateImpl = () => (delayReads ? slowReload.promise : json({data: makeState({phase: 'WORK', entries: correctionEntries()})}));
    delayReads = true;
    gate.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(screen.queryByLabelText(/Сколько свай было на самом деле/)).toBeNull());
    expect(sent.filter((item) => item.command === 'correct-production')).toHaveLength(1);
    slowReload.resolve(json({data: makeState({phase: 'WORK', entries: correctionEntries()})}));
  });
});

describe('ревью №3, п.4: заметка закрытия читается в момент отправки', () => {
  it('подготовка одна, комментарий — актуальный', async () => {
    const closingState = () => makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]});
    stateImpl = () => json({data: closingState()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');
    fireEvent.change(screen.getByPlaceholderText(/осталось 4 сваи/i), {target: {value: 'вывезти грунт к 19:00'}});

    // Подготовка зависает на отправке записи из очереди.
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-1')]));
    const slow = deferred<Response>();
    commandImpl = (body) => (body && body.clientCommandId === 'q-1' ? slow.promise : json({data: {ok: true}}));

    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    await waitFor(() => expect(sent.filter((item) => item.clientCommandId === 'q-1')).toHaveLength(1));

    // Второе нажатие не запускает вторую подготовку.
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    await act(async () => { await Promise.resolve(); });
    expect(sent.filter((item) => item.clientCommandId === 'q-1')).toHaveLength(1);

    slow.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(sent.some((item) => item.command === 'close-shift')).toBe(true));
    const closeBody = sent.find((item) => item.command === 'close-shift') as {comment?: string};
    expect(closeBody.comment).toBe('вывезти грунт к 19:00');
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(1);
  });
});

describe('ревью №4, B5: заметку меняют во время задержанного flush — уходит новая', () => {
  it('двойное нажатие — одна подготовка; правка заметки доходит до отправки', async () => {
    const closingState = () => makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]});
    stateImpl = () => json({data: closingState()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');
    const note = screen.getByPlaceholderText(/осталось 4 сваи/i);
    fireEvent.change(note, {target: {value: 'старый текст'}});

    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-5')]));
    const slow = deferred<Response>();
    commandImpl = (body) => (body && body.clientCommandId === 'q-5' ? slow.promise : json({data: {ok: true}}));

    const closeButton = screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0];
    const flushBefore = vi.mocked(flushQueue).mock.calls.length;
    await act(async () => {
      closeButton.click();
      closeButton.click();
    });
    await waitFor(() => expect(sent.filter((item) => item.clientCommandId === 'q-5')).toHaveLength(1));

    // Пока идёт подготовка, заметка редактируема: в команду уйдёт актуальный текст.
    expect(note).not.toBeDisabled();
    fireEvent.change(note, {target: {value: 'новый текст к 19:00'}});

    slow.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(sent.some((item) => item.command === 'close-shift')).toBe(true));
    const closeBody = sent.find((item) => item.command === 'close-shift') as {comment?: string};
    expect(closeBody.comment).toBe('новый текст к 19:00');
    // Подготовка ровно одна: сам flush вызван один раз (ревью №5, B5), запись
    // из очереди ушла один раз, закрытие — одно.
    expect(vi.mocked(flushQueue).mock.calls.length - flushBefore).toBe(1);
    expect(sent.filter((item) => item.clientCommandId === 'q-5')).toHaveLength(1);
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(1);
  });
});

describe('ревью №3, п.7: ключи происшествия и поправки не трогает чужой успех', () => {
  it('успех выработки не меняет ключи происшествия и поправки', async () => {
    const correctionEntries = () => [{
      id: 'e1', kind: 'PILES' as const, label: 'С 100.30 · 5 шт', value: 5, meters: 15,
      occurredAt: '2026-09-27T05:00:00.000Z', corrections: [],
    }];
    stateImpl = () => json({data: makeState({phase: 'WORK', entries: correctionEntries()})});
    commandImpl = () => json({error: 'Validation failed'}, 400);
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');

    // Происшествие отклонено — ключ зафиксирован.
    fireEvent.click(screen.getByRole('button', {name: 'Ещё'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Записать происшествие'}));
    fireEvent.click(screen.getByRole('button', {name: /Рабочая зона/}));
    fireEvent.click(screen.getByRole('button', {name: 'Утечка'}));
    fireEvent.change(screen.getByLabelText('Как было дело'), {target: {value: 'Разлив масла у насосной'}});
    fireEvent.click(screen.getByRole('button', {name: /^Записать происшествие$/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'report-incident')).toBe(true));
    const incidentKey = sent[sent.length - 1].clientCommandId;

    // Поправка отклонена — свой ключ.
    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    fireEvent.change(screen.getByLabelText(/Сколько свай было на самом деле/), {target: {value: '6'}});
    fireEvent.change(screen.getByLabelText('Что случилось'), {target: {value: 'Ошибся при вводе'}});
    fireEvent.click(screen.getByRole('button', {name: /Записать поправку/}));
    await waitFor(() => expect(sent.some((item) => item.command === 'correct-production')).toBe(true));
    const correctionKey = sent[sent.length - 1].clientCommandId;

    // Успех выработки — соседний вид.
    commandImpl = () => json({data: {ok: true}});
    await openPileForm();
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'log-production')).toHaveLength(1));
    await screen.findByText('Запишите результат работы');

    // Оба ключа не изменились: повторные отправки идут с теми же ключами.
    fireEvent.click(screen.getByRole('button', {name: 'Ещё'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Записать происшествие'}));
    fireEvent.click(screen.getByRole('button', {name: /Рабочая зона/}));
    fireEvent.click(screen.getByRole('button', {name: 'Утечка'}));
    fireEvent.change(screen.getByLabelText('Как было дело'), {target: {value: 'Разлив масла у насосной'}});
    fireEvent.click(screen.getByRole('button', {name: /^Записать происшествие$/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'report-incident')).toHaveLength(2));
    expect(sent[sent.length - 1].clientCommandId).toBe(incidentKey);

    fireEvent.click(screen.getByRole('button', {name: 'Смена'}));
    // Форма поправки — внутри списка и пересоздаётся после форм выработки:
    // открываем и заполняем заново, сверяя ключ ВИДА.
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    fireEvent.change(screen.getByLabelText(/Сколько свай было на самом деле/), {target: {value: '6'}});
    fireEvent.change(screen.getByLabelText('Что случилось'), {target: {value: 'Ошибся при вводе'}});
    fireEvent.click(screen.getByRole('button', {name: /Записать поправку/}));
    await waitFor(() => expect(sent.filter((item) => item.command === 'correct-production')).toHaveLength(2));
    expect(sent[sent.length - 1].clientCommandId).toBe(correctionKey);
  });
});

describe('ревью №3, п.8: отказ чтения localStorage держит закрытие', () => {
  it('брошенное исключение — «не удалось проверить», а не «пусто»', async () => {
    const closingState = () => makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]});
    stateImpl = () => json({data: closingState()});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    const original = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    const spy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation((key: string) => {
      if (String(key) === STORAGE_KEY) throw new Error('storage denied');
      return original(key);
    });
    try {
      fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
      await waitFor(() => expect(screen.getAllByText(/Не удалось проверить очередь на устройстве/).length).toBeGreaterThan(0));
      expect(sent.some((item) => item.command === 'close-shift')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ревью №3, C: черновики переживают перезагрузку страницы', () => {
  it('перезагрузка возвращает черновик своей смены', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const first = render(<OperatorNextApp />);
    await openPileForm();
    first.unmount();

    render(<OperatorNextApp />);
    expect(await screen.findByLabelText('Сколько свай забито, шт')).toHaveValue(5);
    expect(screen.getByRole('button', {name: /С 100\.30/})).toHaveAttribute('aria-pressed', 'true');
  });

  it('чужой черновик не показывается', async () => {
    const foreign = {
      work: {
        ...emptyWorkDraft(),
        mode: 'PILES' as const,
        forms: {...emptyWorkDraft().forms, PILES: {...emptyFormFields(), reference: 'g1', count: '9'}},
      },
    };
    globalThis.localStorage.setItem(draftStorageKey('user-b', 'shift-1') as string, JSON.stringify(foreign));
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    expect(screen.queryByLabelText('Сколько свай забито, шт')).toBeNull();
  });

  it('смена пользователя А→Б без размонтирования: черновик А исчезает и не уходит под Б', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();
    const rawA = globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string);
    expect(rawA ?? '').toContain('"count":"5"');

    // Общий планшет: пользователь меняется в уже открытой оболочке, а
    // перечитывание контекста Б намеренно задерживается — окно, в котором
    // прежние черновики не должны ни показываться, ни сохраняться.
    const slowB = deferred<Response>();
    let switchSlow = false;
    stateImpl = () => (switchSlow ? slowB.promise : json({data: makeState({phase: 'WORK'})}));
    await act(async () => {
      switchSlow = true;
      usePilingStore.setState({currentUser: USER_B});
    });

    // Чужой черновик не показывается: полей А на экране нет.
    expect(screen.queryByLabelText('Сколько свай забито, шт')).toBeNull();
    // И ни одна строка А не записана под Б.
    const rawBEarly = globalThis.localStorage.getItem(draftStorageKey('user-b', 'shift-1') as string);
    expect(rawBEarly ?? '').not.toContain('"count":"5"');

    // Перечитывание Б завершилось: ввод ложится в ключ Б, а ключ А не тронут.
    await act(async () => {
      slowB.resolve(json({data: makeState({phase: 'WORK'})}));
      await Promise.resolve();
    });
    await openPileForm();
    fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '9'}});
    await waitFor(() => {
      const rawB = globalThis.localStorage.getItem(draftStorageKey('user-b', 'shift-1') as string);
      expect(rawB ?? '').toContain('"count":"9"');
    });
    const rawAAfter = globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string);
    expect(rawAAfter ?? '').toContain('"count":"5"');
    expect(rawAAfter ?? '').not.toContain('"count":"9"');
  });

  it('повторный отказ чтения не заменяет свежую память старым документом', async () => {
    let stateCalls = 0;
    stateImpl = () => { stateCalls += 1; return json({data: makeState({phase: 'WORK'})}); };
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-616'}});

    // Дальнейшая запись отказывает (квота), память остаётся свежей.
    const origSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    const origGet = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key, value) => {
      if (String(key).includes(':user-a:')) throw new Error('quota');
      return origSet(key, value);
    });
    try {
      fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
      fireEvent.click(screen.getByRole('button', {name: '+ Добавить залог'}));
      const blows = screen.getAllByLabelText('Ударов');
      const penetration = screen.getAllByLabelText(/^Погружение/);
      ['30', '31', '32'].forEach((v, i) => fireEvent.change(blows[i], {target: {value: v}}));
      ['12', '10', '8'].forEach((v, i) => fireEvent.change(penetration[i], {target: {value: v}}));
      expect(await screen.findByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();

      // Первое перечитывание отказывает: признак «пара загружена» не сбрасывается.
      let throwsLeft = 1;
      const getSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation((key) => {
        if (String(key).startsWith('piling.onx.drafts.v1:') && throwsLeft > 0) {
          throwsLeft -= 1;
          throw new Error('storage offline');
        }
        return origGet(key);
      });
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-e1a')]));
      await act(async () => { globalThis.dispatchEvent(new Event('online')); await Promise.resolve(); });
      await waitFor(() => expect(stateCalls).toBeGreaterThan(1));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      getSpy.mockRestore();

      // Второе перечитывание удаётся — но память (свежие залоги) не заменяется
      // старой версией из хранилища.
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-e1b')]));
      await act(async () => { globalThis.dispatchEvent(new Event('online')); await Promise.resolve(); });
      await waitFor(() => expect(stateCalls).toBeGreaterThan(2));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      const blowsAfter = screen.getAllByLabelText('Ударов');
      expect(blowsAfter).toHaveLength(3);
      expect(blowsAfter[0]).toHaveValue(30);
      expect(blowsAfter[2]).toHaveValue(32);
      expect(screen.getAllByLabelText(/^Погружение/)[1]).toHaveValue(10);
      expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-616');
      // Предупреждение не снято: успешной записи так и не было.
      expect(screen.getByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();

      // Следующая успешная запись — хранилище догоняет, предупреждение уходит.
      setSpy.mockRestore();
      fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-616-А'}});
      await waitFor(() => expect(screen.queryByText(/Черновик не сохранится при перезагрузке страницы/)).toBeNull());
      expect(screen.getAllByLabelText('Ударов')).toHaveLength(3);
    } finally {
      setSpy.mockRestore();
    }
  });

  it('отказ первого чтения не перезаписывает документ; успешное перечтение возвращает его на экран', async () => {
    // В хранилище лежит паспорт; первое чтение этой смены отказало.
    saveShellDrafts('user-a', 'shift-1', {
      work: {...emptyWorkDraft(), mode: 'PASSPORT'},
      checklists: {},
      closeNote: '',
      passport: {...emptyPassportDraft(), grade: 'g1', number: 'С-717'},
    });
    const origGet = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    let throwsLeft = 1;
    const getSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation((key) => {
      if (String(key).startsWith('piling.onx.drafts.v1:') && throwsLeft > 0) {
        throwsLeft -= 1;
        throw new Error('storage offline');
      }
      return origGet(key);
    });
    try {
      stateImpl = () => json({data: makeState({phase: 'WORK'})});
      render(<OperatorNextApp />);
      await screen.findByText('Запишите результат работы');

      // Первое сохранение после отказа чтения НЕ пишет поверх документа.
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const key = draftStorageKey('user-a', 'shift-1') as string;
      expect(origGet(key) ?? '').toContain('С-717');

      // Доступ восстановился, перечитывание прошло: содержимое вернулось на экран.
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-d1')]));
      await act(async () => { globalThis.dispatchEvent(new Event('online')); await Promise.resolve(); });
      await waitFor(() => expect(sent.some((item) => item.clientCommandId === 'q-d1')).toBe(true));
      await waitFor(() => expect(screen.getByPlaceholderText('С-130')).toHaveValue('С-717'));
      expect(origGet(key) ?? '').toContain('С-717');
    } finally {
      getSpy.mockRestore();
    }
  });

  it('смена пользователя во время задержанного flush — чужая смена не закрывается', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    // В подготовке — запись из очереди, её отправка задерживается.
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-d3')]));
    const slow = deferred<Response>();
    commandImpl = (body) => (body && body.clientCommandId === 'q-d3' ? slow.promise : json({data: {ok: true}}));

    const closeButton = screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0];
    await act(async () => { closeButton.click(); });
    await waitFor(() => expect(sent.filter((item) => item.clientCommandId === 'q-d3')).toHaveLength(1));

    // Пока подготовка идёт, в ту же оболочку входит Б.
    await act(async () => {
      usePilingStore.setState({currentUser: USER_B});
    });

    // Подготовка А заканчивается — но чужую смену она не закрывает.
    await act(async () => { slow.resolve(json({data: {ok: true}})); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(0);
    // И на экране нет чужой ошибки от прерванного закрытия.
    expect(screen.queryByText(/Не удалось проверить очередь|неотправленных записей/)).toBeNull();
  });

  it('успешное перечитывание не снимает предупреждение об отказе записи — только новая запись', async () => {
    let stateCalls = 0;
    stateImpl = () => { stateCalls += 1; return json({data: makeState({phase: 'WORK'})}); };
    render(<OperatorNextApp />);
    await openPileForm();

    // Запись черновика отказала (например, квота), при этом чтение работает.
    const origSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key, value) => {
      if (String(key).includes(':user-a:')) throw new Error('quota');
      return origSet(key, value);
    });
    try {
      fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '6'}});
      expect(await screen.findByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();

      // Успешное перечитывание той же смены (черновик не менялся): предупреждение
      // обязано остаться — последняя запись так и не прошла.
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('q-d2')]));
      await act(async () => { globalThis.dispatchEvent(new Event('online')); await Promise.resolve(); });
      await waitFor(() => expect(sent.some((item) => item.clientCommandId === 'q-d2')).toBe(true));
      // Перечитывание после отправки действительно прошло…
      await waitFor(() => expect(stateCalls).toBeGreaterThan(1));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      // …и предупреждение всё равно на месте — последняя запись так и не прошла.
      expect(screen.getByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();

      // Следующая УСПЕШНАЯ запись актуальной памяти — предупреждение уходит.
      setSpy.mockRestore();
      fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '7'}});
      await waitFor(() => expect(screen.queryByText(/Черновик не сохранится при перезагрузке страницы/)).toBeNull());
    } finally {
      setSpy.mockRestore();
    }
  });

  it('отказ очистки подтверждённого паспорта — видимая ошибка, не молчание', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    fireEvent.click(screen.getByRole('button', {name: /Сваи с паспортом/}));
    fireEvent.change(await screen.findByLabelText('Марка сваи'), {target: {value: 'g1'}});
    fireEvent.change(screen.getByPlaceholderText('С-130'), {target: {value: 'С-818'}});

    // Очистка при подтверждении не сможет записаться — это должно быть видно.
    const origSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation((key, value) => {
      if (String(key).includes(':user-a:')) throw new Error('denied');
      return origSet(key, value);
    });
    try {
      fireEvent.click(screen.getByRole('button', {name: /Записать сваю с паспортом/}));
      await waitFor(() => expect(sent.some((item) => item.command === 'log-production')).toBe(true));
      // Форма закрылась (список), а очистка не сохранилась — видимая ошибка.
      expect(await screen.findByText(/Черновик не сохранится при перезагрузке страницы/)).toBeInTheDocument();
    } finally {
      setSpy.mockRestore();
    }
  });

  it('отказ записи после успешного старта — честный статус на экране формы', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    render(<OperatorNextApp />);
    await openPileForm();
    // Старт был успешен: черновик дошёл до хранилища.
    expect(globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string) ?? '').toContain('"count":"5"');

    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      fireEvent.change(screen.getByLabelText('Сколько свай забито, шт'), {target: {value: '6'}});
      expect((await screen.findAllByText(/Черновик не сохранится при перезагрузке страницы/)).length).toBeGreaterThan(0);
    } finally {
      setSpy.mockRestore();
    }
  });

  it('после подтверждения черновика в хранилище нет, и форма не поднимается', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const first = render(<OperatorNextApp />);
    await openPileForm();
    fireEvent.click(screen.getByRole('button', {name: /^Записать/}));
    await waitFor(() => expect(screen.getByText('Запишите результат работы')).toBeInTheDocument());

    const raw = globalThis.localStorage.getItem(draftStorageKey('user-a', 'shift-1') as string);
    const stored = raw ? JSON.parse(raw) as {work?: {forms?: {PILES?: {count?: string}}}} : null;
    expect(stored?.work?.forms?.PILES?.count ?? '').toBe('');
    first.unmount();

    render(<OperatorNextApp />);
    await screen.findByText('Запишите результат работы');
    expect(screen.queryByLabelText('Сколько свай забито, шт')).toBeNull();
  });

  it('явное «Очистить» — пустая форма после перезагрузки', async () => {
    stateImpl = () => json({data: makeState({phase: 'WORK'})});
    const first = render(<OperatorNextApp />);
    await openPileForm();
    fireEvent.click(screen.getByRole('button', {name: 'Очистить'}));
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(null));
    first.unmount();

    render(<OperatorNextApp />);
    await waitFor(() => expect(screen.getByLabelText('Сколько свай забито, шт')).toHaveValue(null));
    expect(screen.getByRole('button', {name: 'Очистить'})).toBeDisabled();
  });

  it('недоступное хранилище — честное «не сохранится при перезагрузке»', async () => {
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      stateImpl = () => json({data: makeState({phase: 'PRESHIFT_INSPECTION', checklists: [makeChecklist()]})});
      render(<OperatorNextApp />);
      await screen.findByTestId('inspection-item-i-level');
      Object.defineProperty(globalThis.navigator, 'onLine', {value: false, configurable: true});
      await act(async () => { globalThis.dispatchEvent(new Event('offline')); });

      fireEvent.click(screen.getByRole('button', {name: /Отложить осмотр/}));
      expect((await screen.findAllByText(/Черновик не сохранится при перезагрузке страницы/)).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Осмотр сохранён на устройстве/)).toBeNull();
    } finally {
      setSpy.mockRestore();
      delete (globalThis.navigator as unknown as Record<string, unknown>).onLine;
    }
  });
});
