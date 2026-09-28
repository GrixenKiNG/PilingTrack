import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {OperatorNextApp} from '../operator-next-app';
import {checklistView, makeChecklist, makeState} from './fixtures';

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
  it('во время подготовки заметка закрыта, повтор не запускает вторую подготовку', async () => {
    stateImpl = () => json({data: makeState({phase: 'CLOSING', checklists: [checklistView('EO_AFTER', true)]})});
    render(<OperatorNextApp />);
    await screen.findByText('Проверьте итоги и закройте смену');

    // Запись на устройстве, отправка которой «зависнет».
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-1')]));
    const slowSend = deferred<Response>();
    commandImpl = (body) => (body && body.command === 'log-production' ? slowSend.promise : json({data: {ok: true}}));

    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);

    // Идёт подготовка — заметка закрыта.
    await waitFor(() => expect(screen.getByPlaceholderText(/осталось 4 сваи/i)).toBeDisabled());
    // Повторное нажатие ничего не запускает.
    fireEvent.click(screen.getAllByRole('button', {name: /Закрыть смену и отправить отчёт/})[0]);
    await act(async () => { await Promise.resolve(); });
    expect(sent.filter((item) => item.command === 'close-shift')).toHaveLength(0);

    // Подготовка закончилась: запись ушла, смена закрывается.
    slowSend.resolve(json({data: {ok: true}}));
    await waitFor(() => expect(sent.some((item) => item.command === 'close-shift')).toBe(true));
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

describe('ревью №2, п.6: гонка установок — оба запроса и оба ответа', () => {
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
    const lateB = deferred<Response>();
    const reads: string[] = [];
    stateImpl = (url) => {
      reads.push(url);
      return url.includes('equipmentId=eq-2') ? lateB.promise : json({data: stateA});
    };

    render(<OperatorNextApp />);
    await screen.findByRole('button', {name: /Принять установку/});

    // Запрос Б уходит и «висит».
    fireEvent.click(screen.getByRole('button', {name: /СУ-2/}));
    // Строки уже погашены — второй выбор делаем напрямую, чтобы получить
    // настоящую гонку двух чтений по разным установкам (ревью №2, п.6).
    const rowA = screen.getByRole('button', {name: /СУ-1/}) as HTMLButtonElement;
    rowA.removeAttribute('disabled');
    fireEvent.click(rowA);

    // Оба запроса действительно запущены: два чтения по разным установкам.
    await waitFor(() => expect(reads.some((url) => url.includes('equipmentId=eq-2'))).toBe(true));
    await waitFor(() => expect(reads.some((url) => url.includes('equipmentId=eq-1'))).toBe(true));
    await waitFor(() => expect(screen.getByText('Основная СУ-1')).toBeInTheDocument());

    // Устаревший ответ Б приходит позже и не должен победить.
    lateB.resolve(json({data: stateB}));
    await act(async () => { await Promise.resolve(); });
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
    stateImpl = () => json({data: makeState({
      phase: 'CLOSING',
      checklists: servicePresent ? [checklistView('EO_AFTER', false)] : [],
    })});
    render(<OperatorNextApp />);

    fireEvent.click(await screen.findByRole('button', {name: /Выполнить осмотр после работы/}));
    // Пока осмотр открыт, сервер перестал отдавать этот список.
    servicePresent = false;
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([queueEntry('queued-9')]));
    await act(async () => { globalThis.dispatchEvent(new Event('online')); });

    expect(await screen.findByText(/Сервер не отдал этот чек-лист/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));
    expect(await screen.findByText(/Сервер не отдал этот чек-лист/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Назад к смене'}));
    expect(await screen.findByText('Чек-лист осмотра после работы не получен')).toBeInTheDocument();
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
