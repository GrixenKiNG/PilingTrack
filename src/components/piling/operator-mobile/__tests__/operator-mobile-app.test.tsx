/**
 * v1 машиниста: отказ сервера — не обрыв связи (R76, находка 4).
 *
 * Раньше любой сбой загрузки состояния, кроме 401/403, рисовался под заголовком
 * «Нет связи» с советом «восстановите связь». На 500/503 это дезинформация:
 * связь есть, сломан сервер, и чинить его будет механик или администратор, а не
 * машинист с выключенным и включённым Wi-Fi.
 */
import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

const api = vi.hoisted(() => ({
  fetchState: vi.fn(),
  sendCommand: vi.fn(),
}));

/** Очередь на устройстве, которой управляет тест (R76, находки 17 и 18). */
const queue = vi.hoisted(() => ({items: [] as QueuedCommand[]}));

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
    queued: queue.items, flush: vi.fn(), retry: vi.fn(), retryFailed: vi.fn(), discard: vi.fn(),
  }),
}));
vi.mock('../operator-type.css', () => ({}));
vi.mock('../operator-concept.css', () => ({}));

import {ApiError, QueuedOffline} from '@/components/piling/operator-mobile/api';
import type {QueuedCommand} from '@/components/piling/operator-mobile/offline-queue';
import {OperatorMobileApp} from '../operator-mobile-app';

beforeEach(() => {
  api.fetchState.mockReset();
  api.sendCommand.mockReset();
  queue.items = [];
});

describe('v1: загрузка состояния не удалась', () => {
  it('503 показывает «Сервер не отвечает» и не велит восстанавливать связь', async () => {
    api.fetchState.mockRejectedValue(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Сервер не отвечает')).toBeInTheDocument();
    expect(screen.getByText(/Связь есть, но сервер временно не работает/)).toBeInTheDocument();
    expect(screen.queryByText(/Восстановите связь и повторите/)).not.toBeInTheDocument();
    // Кнопка повтора остаётся: сервер может подняться сам.
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });

  it('обрыв сети по-прежнему «Нет связи» с советом восстановить связь', async () => {
    api.fetchState.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByText(/Восстановите связь и повторите/)).toBeInTheDocument();
    // Текст браузера («Failed to fetch») на экран не попадает — вместо него
    // русская строка (R76, находка 5).
    expect(screen.getByText('Нет связи с сервером. Проверьте интернет и повторите.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByText('Сервер не отвечает')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });
});

/**
 * Отказ команды с подробностями (R76, находка 10).
 *
 * Общая фраза сервера без перечня полей бесполезна: машинист после «Паспорт
 * заполнен не полностью» не знает, какое из пятнадцати полей править. Здесь
 * проверяется вся цепочка — отказ команды → `details` у `ApiError` → плашка
 * над экраном со списком.
 */
const workState = {
  phase: 'WORK',
  productionDate: '2026-09-20',
  shift: {id: 'shift-1', productionDate: '2026-09-20'},
  assignment: {equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А', lastMeter: null},
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true, acknowledgedAt: '2026-09-20T05:00:00.000Z'},
    knowledge: {ok: true}, documents: [],
  },
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'].map((stage) => ({stage, done: true})),
  permit: {allowed: true, blocks: []},
  dictionaries: {pileGrades: [], drillingTypes: [], downtimeReasons: []},
  production: {
    piles: {count: 12, meters: 60},
    drilling: {count: 4, meters: 24},
    downtimeHours: 0,
  },
  entries: [], warnings: [], defects: [], incidents: [], progress: [],
} as unknown as OperatorMobileState;

async function finishWork(failure: unknown) {
  api.fetchState.mockResolvedValue(workState);
  api.sendCommand.mockRejectedValue(failure);

  render(<OperatorMobileApp />);

  fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
  fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

  return screen.findAllByRole('alert');
}

describe('v1: отказ команды с подробностями', () => {
  it('показывает, что именно не заполнено, — фраза один раз, пункты списком', async () => {
    const alerts = await finishWork(new ApiError(400, 'Паспорт заполнен не полностью', [
      {field: 'pileNumber', message: 'Укажите номер сваи по проекту'},
    ]));

    const note = alerts.find((node) => node.textContent?.includes('Укажите номер сваи по проекту'));
    expect(note).toHaveTextContent('Паспорт заполнен не полностью');
    // Раньше фраза приходила дважды — плашкой над экраном и в самом экране
    // (`F-V1-ERROR-DETAILS-b`). Теперь её рисует только экран, один раз.
    expect(screen.getAllByText('Паспорт заполнен не полностью')).toHaveLength(1);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent))
      .toContain('Укажите номер сваи по проекту');
  });

  it('разбор схемы запроса машинисту не показывается', async () => {
    const alerts = await finishWork(new ApiError(400, 'Паспорт заполнен не полностью', [
      {code: 'invalid_type', path: ['entry'], message: 'Invalid input: expected object'},
    ]));

    expect(alerts.some((node) => node.textContent?.includes('Invalid input'))).toBe(false);
    expect(alerts.some((node) => node.textContent?.includes('Паспорт заполнен не полностью'))).toBe(true);
  });
});

/**
 * Тихое перечитывание после принятой команды (R76, находка 9).
 *
 * Команда уже принята сервером; сбой следующего за ней чтения значит лишь
 * несвежий экран. Раньше он заменял экран полноэкранным «Нет связи», и машинист
 * читал это как «моя свая не записалась».
 */
describe('v1: перечитывание после успешной команды', () => {
  it('сбой перечитывания не заменяет экран, а показывает уведомление', async () => {
    api.fetchState.mockResolvedValueOnce(workState);
    api.fetchState.mockRejectedValueOnce(new ApiError(503, 'Сервис временно недоступен'));
    api.sendCommand.mockResolvedValue(undefined);

    render(<OperatorMobileApp />);

    fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

    expect(await screen.findByText(/Записано\. Экран не обновился/)).toBeInTheDocument();
    // Экран прежний: полноэкранного отказа нет ни под каким заголовком.
    expect(screen.queryByText('Сервер не отвечает')).not.toBeInTheDocument();
    expect(screen.queryByText('Нет связи')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: 'Завершить работу'}).length).toBeGreaterThan(0);
  });
});

/**
 * Несвежий экран перечитывается сам (F-V1-QUIET-RELOAD-b).
 *
 * Прежнее уведомление обещало «обновится автоматически при связи», но
 * автоматического перечитывания не было: очередь после удачной немедленной
 * команды пуста, и `useOfflineQueue` не звал `reload`. Счётчик свай и фаза
 * оставались прежними, и машиниста приходилось убеждать не вводить запись
 * повторно — теперь экран догоняет состояние сам, без следующего действия.
 */
describe('v1: несвежий экран перечитывается сам', () => {
  const freshState = {
    ...workState,
    production: {
      piles: {count: 99, meters: 495},
      drilling: {count: 4, meters: 24},
      downtimeHours: 0,
    },
  } as unknown as OperatorMobileState;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Команда принята, а следующее за ней перечитывание упало — уведомление на экране. */
  async function commandThenFailedReload() {
    api.fetchState.mockResolvedValueOnce(workState);
    api.sendCommand.mockResolvedValue(undefined);
    api.fetchState.mockRejectedValueOnce(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

    await screen.findByText(/Записано\. Экран не обновился/);
  }

  it('по событию online уведомление исчезает, экран показывает свежие данные', async () => {
    await commandThenFailedReload();

    api.fetchState.mockResolvedValueOnce(freshState);
    await act(async () => {
      globalThis.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText(/Записано\. Экран не обновился/)).not.toBeInTheDocument();
    expect((await screen.findAllByText('99')).length).toBeGreaterThan(0);
  });

  it('кнопка «Обновить» перечитывает состояние тем же тихим способом', async () => {
    await commandThenFailedReload();

    api.fetchState.mockResolvedValueOnce(freshState);
    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));

    expect((await screen.findAllByText('99')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Записано\. Экран не обновился/)).not.toBeInTheDocument();
  });

  it('таймер повторяет перечитывание, не дожидаясь действия человека', async () => {
    api.fetchState.mockResolvedValueOnce(workState);
    api.sendCommand.mockResolvedValue(undefined);
    api.fetchState.mockRejectedValueOnce(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    // Загрузку ждём на настоящих таймерах, фейковые ставим до нажатия: иначе
    // интервал повтора взведётся на настоящих часах, и `advanceTimersByTime`
    // его не увидит (как в тестах истёкшего входа выше).
    const buttons = await screen.findAllByRole('button', {name: 'Завершить работу'});
    vi.useFakeTimers();

    fireEvent.click(buttons[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));
    await act(async () => {});

    expect(screen.getByText(/Записано\. Экран не обновился/)).toBeInTheDocument();

    api.fetchState.mockResolvedValueOnce(freshState);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });

    expect(screen.queryByText(/Записано\. Экран не обновился/)).not.toBeInTheDocument();
    // Загрузка + упавшее тихое чтение + успешное по таймеру.
    expect(api.fetchState).toHaveBeenCalledTimes(3);
  });
});

/**
 * Истёкшая сессия на команде уводит на вход (R76, находка 8).
 *
 * 401 от команды откладывает запись «после входа»: она сольётся, когда войдёт
 * тот же пользователь (очередь привязана к `ownerId`). Но пока экран не просит
 * войти, машинист продолжает вводить сваи, которые копятся и не уходят. Раньше
 * редирект на `/login` был только у загрузки состояния.
 */
describe('v1: истёкший вход на команде', () => {
  beforeEach(() => {
    // window.location в happy-dom общий для файла: без сброса переход на
    // /login из одного теста остался бы в следующем.
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function sendFinishWork(failure: unknown) {
    api.fetchState.mockResolvedValue(workState);
    api.sendCommand.mockRejectedValue(failure);

    render(<OperatorMobileApp />);

    // Загрузку состояния ждём на настоящих таймерах: под подменёнными
    // `findBy*` не дожидается элемента. Фейковые ставим только перед нажатием,
    // в котором взводится таймер перехода.
    const buttons = await screen.findAllByRole('button', {name: 'Завершить работу'});
    vi.useFakeTimers();

    fireEvent.click(buttons[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));
    await act(async () => {});
  }

  it('401 показывает уведомление и через паузу уводит на /login', async () => {
    await sendFinishWork(new QueuedOffline('Выработка', 'после входа'));

    expect(screen.getByText(/Сессия истекла\. Записи сохранены на телефоне/)).toBeInTheDocument();
    // До паузы экран ещё не ушёл: машинист успевает прочитать причину.
    expect(window.location.pathname).not.toBe('/login');

    act(() => { vi.advanceTimersByTime(2500); });

    expect(window.location.pathname).toBe('/login');
  });

  it('обрыв связи — прежнее поведение: без уведомления и без перехода', async () => {
    await sendFinishWork(new QueuedOffline('Выработка'));

    act(() => { vi.advanceTimersByTime(2500); });

    expect(screen.queryByText(/Сессия истекла/)).not.toBeInTheDocument();
    expect(window.location.pathname).not.toBe('/login');
    // Экран работы на месте — форма закрылась как при обычной постановке в очередь.
    expect(screen.getAllByRole('button', {name: 'Завершить работу'}).length).toBeGreaterThan(0);
  });
});

/**
 * Тупики рабочего места (F-V1-DEAD-ENDS, R76 находки 23 и 26).
 *
 * Два экрана v1 не оставляли человеку выхода: отказ по роли — без возможности
 * войти другим пользователем, а фаза работы без смены — голой строкой «Смена не
 * найдена.» без объяснения и кнопки.
 */
describe('v1: экран без выхода — не тупик', () => {
  it('403 показывает причину и кнопку «Войти другим пользователем»', async () => {
    api.fetchState.mockRejectedValue(new ApiError(403, 'Экран доступен только машинисту'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Экран доступен только машинисту')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Войти другим пользователем'})).toBeInTheDocument();
  });

  it('фаза работы без смены объясняет причину, «Обновить» перечитывает состояние', async () => {
    api.fetchState.mockResolvedValueOnce({...workState, shift: null} as unknown as OperatorMobileState);
    api.fetchState.mockResolvedValue(workState);

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Смена не найдена.')).toBeInTheDocument();
    expect(screen.getByText('Смену могли закрыть на другом устройстве.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Обновить'}));

    // Состояние перечитано: смена вернулась, экран работы открылся.
    expect((await screen.findAllByRole('button', {name: 'Завершить работу'})).length).toBeGreaterThan(0);
    expect(api.fetchState).toHaveBeenCalledTimes(2);
  });
});

/**
 * Отклонённая запись видна и на экранах отказа (R76, находка 17).
 *
 * Строка состояния при `FAILED` пишет «Сервер отклонил запись — причина показана
 * ниже». На экранах «Нет связи»/«Сервер не отвечает» и «доступ закрыт» ниже ничего
 * не было: карточка с причиной и кнопкой «Удалить запись» оставалась на невидимом
 * экране, и причину отказа нельзя было ни прочитать, ни убрать запись.
 */
describe('v1: очередь видна на экране отказа загрузки', () => {
  const failedItem: QueuedCommand = {
    clientCommandId: 'cmd-failed-1',
    label: 'Выработка',
    command: {command: 'log-production'},
    queuedAt: '2026-09-20T05:00:00.000Z',
    attempts: 1,
    state: 'FAILED',
    lastError: 'Смена уже закрыта',
  };

  it('503 с отклонённой записью показывает её причину и кнопку «Удалить запись»', async () => {
    queue.items = [failedItem];
    api.fetchState.mockRejectedValue(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Сервер не отвечает')).toBeInTheDocument();
    // Строка состояния обещает причину ниже — причина действительно ниже.
    expect(screen.getByText('Смена уже закрыта')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Удалить запись'})).toBeInTheDocument();
  });
});

/**
 * Запись легла в очередь — экран об этом говорит (R76, находка 18).
 *
 * Раньше при обрыве связи форма просто закрывалась: машинист не получал ни
 * слова о том, что введённое сохранено на устройстве. Сообщение `QueuedOffline`
 * в `run()` проглатывалось (`setActionError(null)`), а плашку вверху на рабочем
 * экране легко не заметить.
 */
describe('v1: запись легла в очередь — экран говорит об этом', () => {
  it('обрыв связи показывает текст «сохранено на устройстве» без кнопки «Обновить»', async () => {
    api.fetchState.mockResolvedValue(workState);
    api.sendCommand.mockRejectedValue(new QueuedOffline('Выработка'));

    render(<OperatorMobileApp />);

    fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

    expect(await screen.findByText('Выработка: сохранено на устройстве, отправим при связи')).toBeInTheDocument();
    // Уведомление без кнопки «Обновить»: перечитывать нечего — сервер записи ещё не видел.
    expect(screen.queryByRole('button', {name: 'Обновить'})).not.toBeInTheDocument();
    // Экран работы на месте: форма закрылась как при обычной постановке в очередь.
    expect(screen.getAllByRole('button', {name: 'Завершить работу'}).length).toBeGreaterThan(0);
  });
});

/**
 * Отказ не теряется при переходе на экран закрытой смены (R82, находка 5).
 *
 * Смену закрыли на другом устройстве, экран машиниста ещё в фазе работы. Он
 * вводит «12 свай», сервер отвечает 409 «Смена уже закрыта», рабочее место
 * перечитывает состояние и получает фазу `CLOSED`. Раньше `ClosedScreen` не
 * принимал `error`: итог смены показывался без введённых свай и без единой
 * строки о причине — молчаливая потеря.
 */
describe('v1: отказ виден на экране закрытой смены', () => {
  const closedState = {
    ...workState,
    phase: 'CLOSED',
    shift: null,
    receipt: null,
    production: {
      piles: {count: 12, meters: 60},
      drilling: {count: 0, meters: 0},
      downtimeHours: 0,
    },
  } as unknown as OperatorMobileState;

  const failedItem: QueuedCommand = {
    clientCommandId: 'cmd-failed-closed',
    label: 'Выработка',
    command: {command: 'log-production'},
    queuedAt: '2026-09-20T05:00:00.000Z',
    attempts: 1,
    state: 'FAILED',
    lastError: 'Смена уже закрыта',
  };

  it('409 → перечитывание даёт CLOSED: отказ и отклонённая запись видны', async () => {
    queue.items = [failedItem];
    api.fetchState.mockResolvedValueOnce(workState);
    api.fetchState.mockResolvedValue(closedState);
    api.sendCommand.mockRejectedValue(new ApiError(409, 'Смена уже закрыта'));

    render(<OperatorMobileApp />);

    fireEvent.click((await screen.findAllByRole('button', {name: 'Завершить работу'}))[0]);
    fireEvent.click(screen.getByRole('button', {name: 'Да, работа завершена'}));

    // Экран перечитан в фазу закрытой смены.
    expect(await screen.findByText('Номер отчёта пока недоступен')).toBeInTheDocument();
    // Строка отказа — на самом экране (у `ErrorNote` только текст, без кнопок).
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent === 'Смена уже закрыта')).toBe(true);
    // Запись не исчезла: она в плашке очереди как отклонённая, с выходом «Удалить».
    expect(screen.getByText('Выработка не принята')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Удалить запись'})).toBeInTheDocument();
  });
});
