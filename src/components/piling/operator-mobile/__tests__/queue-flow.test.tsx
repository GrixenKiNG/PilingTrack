/**
 * Сценарный прогон живого экрана машиниста v1: очередь, отказы, повтор (T-V1-QUEUE-FLOW).
 *
 * За ~25 правок 30.09–01.10 поведение очереди проверялось по кускам: отдельно
 * `offline-queue.ts`, отдельно `api.ts`, отдельно плашка. Целая цепочка —
 * «машинист записал выработку → сеть оборвалась/сервер отказал → что видно на
 * экране и что уходит само» — не собиралась ни разу. Здесь она собирается
 * целиком на настоящих `offline-queue.ts`, `api.ts` и `use-offline-queue.ts`:
 * подменяются только глобальный `fetch`, `localStorage` и `navigator.onLine`.
 */
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

// Стили не участвуют в поведении, а PostCSS-настройка проекта в vitest не грузится
// (так же поступают соседние тесты этой папки).
vi.mock('../operator-type.css', () => ({}));
vi.mock('../operator-concept.css', () => ({}));

import {OperatorMobileApp} from '../operator-mobile-app';

/**
 * Состояние смены в фазе работы (взято из `operator-mobile-app.test.tsx`).
 * Отличие одно: есть марка сваи и пройден ТБ по забивке — иначе рабочий экран
 * вместо формы записи показывает требование пройти чек-лист, и до `log-production`
 * не добраться.
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
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE', 'TB_PILING', 'TB_DRILLING']
    .map((stage) => ({stage, done: true})),
  permit: {allowed: true, blocks: []},
  dictionaries: {
    pileGrades: [{id: 'g1', name: 'С 300.30-6', lengthMm: 6000}],
    drillingTypes: [],
    downtimeReasons: [],
  },
  production: {
    piles: {count: 12, meters: 60},
    drilling: {count: 4, meters: 24},
    downtimeHours: 0,
  },
  entries: [], warnings: [], defects: [], incidents: [], progress: [],
} as unknown as OperatorMobileState;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

/** Ответ на POST команды. По умолчанию — обрыв сети, каждый сценарий ставит свой. */
type CommandResponder = () => Response | Promise<Response>;
let respondCommand: CommandResponder;

/**
 * Ответ на GET состояния. По умолчанию — фаза работы; сценарий может подменить
 * его (экран закрытой смены, закрытие смены) или отдать состояние по порядку
 * чтений (409 перечитывает состояние).
 */
type StateResponder = () => Response | Promise<Response>;
let respondState: StateResponder;

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/operator/mobile/state')) return respondState();
  if (url === '/api/operator/mobile/command') return respondCommand();
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
  respondCommand = () => { throw new TypeError('Failed to fetch'); };
  respondState = () => jsonResponse({data: workState});
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Открыть форму выработки и записать 12 свай марки g1. */
function logProduction(): void {
  fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
  fireEvent.change(screen.getByLabelText('Марка сваи'), {target: {value: 'g1'}});
  fireEvent.change(screen.getByLabelText('Свай, шт'), {target: {value: '12'}});
  fireEvent.click(screen.getByRole('button', {name: 'Записать'}));
}

/** Дождаться, пока осядут промисы под фейковыми часами (микрозадачи + ноль мс). */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  }
}

describe('T-V1-QUEUE-FLOW: обрыв сети и восстановление', () => {
  it('запись уходит на устройство, при появлении связи уходит на сервер', async () => {
    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Добавить сваю'});

    logProduction();

    // Уведомление «сохранено на устройстве» и строка состояния с очередью.
    expect(await screen.findByText('Выработка: сохранено на устройстве, отправим при связи'))
      .toBeInTheDocument();
    expect(screen.getByText('Ожидает отправки: 1')).toBeInTheDocument();
    expect(within(screen.getByTestId('offline-queue-banner')).getByText(/На устройстве: Выработка/))
      .toBeInTheDocument();

    // Связь вернулась: команда принята, событие online запускает слив очереди.
    respondCommand = () => jsonResponse({data: {reportId: 'r1'}});
    await act(async () => { globalThis.dispatchEvent(new Event('online')); });

    expect(await screen.findByText('Всё отправлено')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-queue-banner')).toBeNull();
  });
});

describe('T-V1-QUEUE-FLOW: сервер отклонил запись по существу', () => {
  it('409 показывает причину у кнопки и отвергнутую запись с удалением', async () => {
    respondCommand = () => jsonResponse({error: 'Смена уже закрыта'}, 409);

    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Добавить сваю'});

    logProduction();

    // Отказ по существу — на экране, рядом с кнопкой (запись NOT accepted).
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent === 'Смена уже закрыта')).toBe(true);
    expect(screen.getByRole('button', {name: 'Записать'})).toBeInTheDocument();

    // Запись осталась на устройстве как отвергнутая, с выходом «Удалить запись».
    const banner = screen.getByTestId('offline-queue-banner');
    expect(within(banner).getByText('Выработка не принята')).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', {name: 'Удалить запись'}));
    // Удаление — только по явному подтверждению.
    fireEvent.click(screen.getByRole('button', {name: 'Да, убрать'}));

    expect(screen.queryByTestId('offline-queue-banner')).toBeNull();
  });
});

describe('T-V1-QUEUE-FLOW: отказ сервера и повтор по таймеру', () => {
  beforeEach(() => {
    // Интервал повтора взводится при монтировании — фейковые часы нужны раньше него.
    vi.useFakeTimers();
  });

  it('503 HTML оставляет запись PENDING и уходит повтором через RETRY_EVERY_MS', async () => {
    respondCommand = () => new Response('<html>503 Service Unavailable</html>', {status: 503});

    render(<OperatorMobileApp />);
    await settle();
    logProduction();
    await settle();

    // Связь есть — отказал сервер: уведомление говорит про сервер, а не про связь
    // (аудит R89, находка 4).
    expect(screen.getByText('Выработка: сервер не принял запись, повторим автоматически'))
      .toBeInTheDocument();
    const banner = screen.getByTestId('offline-queue-banner');
    expect(banner).toHaveTextContent('Сервер не принял запись, повторим автоматически.');
    expect(banner).toHaveTextContent(
      'Сервер временно недоступен (код 503). Запись сохранена — отправим автоматически.',
    );

    // Сервер поднялся: таймер очереди (RETRY_EVERY_MS = 30 000) шлёт запись сам.
    respondCommand = () => jsonResponse({data: {reportId: 'r1'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await settle();

    expect(screen.getByText('Всё отправлено')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-queue-banner')).toBeNull();
  });
});

describe('T-V1-QUEUE-FLOW: истёкшая сессия на записи выработки', () => {
  beforeEach(() => {
    // window.location в happy-dom общий для файла: без сброса переход на
    // /login из этого сценария остался бы в следующем (как в
    // operator-mobile-app.test.tsx).
    window.history.replaceState(null, '', '/');
  });

  it('401: уведомление, запись PENDING с «Войдите снова», через 2,5 с — /login', async () => {
    respondCommand = () => jsonResponse({error: 'Войдите в систему'}, 401);

    render(<OperatorMobileApp />);
    // Загрузку ждём на настоящих таймерах: под подменёнными `findBy*` не
    // дожидается элемента. Фейковые ставим только перед нажатием, в котором
    // взводится таймер перехода.
    await screen.findByRole('button', {name: 'Добавить сваю'});
    vi.useFakeTimers();

    logProduction();
    await settle();

    // Уведомление об истёкшем входе — то же, что у команды-перехода.
    expect(screen.getByText(/Сессия истекла\. Записи сохранены на телефоне/)).toBeInTheDocument();
    // Запись не потеряна: она ждёт отправки и говорит, что делать.
    const banner = screen.getByTestId('offline-queue-banner');
    expect(banner).toHaveTextContent('Войдите снова — запись отправится после входа');
    expect(screen.getByText('Ожидает отправки: 1')).toBeInTheDocument();
    // До паузы экран ещё не ушёл: машинист успевает прочитать причину.
    expect(window.location.pathname).not.toBe('/login');

    act(() => { vi.advanceTimersByTime(2500); });

    expect(window.location.pathname).toBe('/login');
  });
});

describe('T-V1-QUEUE-FLOW: отказ проверки безопасности (403 CSRF)', () => {
  const csrfBody = {error: 'CSRF validation failed: origin mismatch'};

  it('запись выработки: запись PENDING, русский текст про проверку безопасности', async () => {
    respondCommand = () => jsonResponse(csrfBody, 403);

    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Добавить сваю'});

    logProduction();

    // Русское указание вместо английской строки сервера (аудит R89, находка 1).
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent?.includes('Запрос отклонён проверкой безопасности')))
      .toBe(true);
    expect(screen.queryByText(/CSRF validation failed/)).toBeNull();

    // CSRF-403 — временный отказ: запись ждёт, а не отвергнута.
    const banner = screen.getByTestId('offline-queue-banner');
    expect(banner).toHaveTextContent('Запрос отклонён проверкой безопасности');
    expect(screen.getByText('Ожидает отправки: 1')).toBeInTheDocument();
  });

  it('закрытие смены (close-shift): тот же 403 — текст БЕЗ «запись сохранена»', async () => {
    // Команда-переход в очередь не кладётся: обещание сохранения было бы ложью
    // (F-R89-API-TEXTS).
    respondState = () => jsonResponse({
      data: {
        ...workState,
        phase: 'CLOSING',
        checklists: [...workState.checklists, {stage: 'EO_AFTER', done: true}],
      },
    });
    respondCommand = () => jsonResponse(csrfBody, 403);

    render(<OperatorMobileApp />);
    const close = await screen.findByRole('button', {name: 'Закрыть смену и отправить отчёт'});

    fireEvent.click(close);

    expect(await screen.findByText(
      'Запрос отклонён проверкой безопасности. Обновите страницу и повторите действие.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/запись сохранена/)).toBeNull();
    // Сохранять нечего — плашки очереди нет.
    expect(screen.queryByTestId('offline-queue-banner')).toBeNull();
  });
});

describe('T-V1-QUEUE-FLOW: 409 переводит экран в закрытую смену', () => {
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

  it('409 «Смена уже закрыта»: отказ на экране закрытой смены, запись — с «Удалить запись»', async () => {
    // Первое чтение — фаза работы, перечитывание на 409 — уже закрытая смена.
    let stateCalls = 0;
    respondState = () => {
      stateCalls += 1;
      return jsonResponse({data: stateCalls === 1 ? workState : closedState});
    };
    respondCommand = () => jsonResponse({error: 'Смена уже закрыта'}, 409);

    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Добавить сваю'});

    logProduction();

    // Экран перечитан в фазу закрытой смены.
    expect(await screen.findByText('Номер отчёта пока недоступен')).toBeInTheDocument();
    // Текст отказа — на самом экране закрытой смены (R82, находка 5).
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((node) => node.textContent === 'Смена уже закрыта')).toBe(true);
    // Отклонённая запись осталась видимой, с выходом «Удалить запись».
    const banner = screen.getByTestId('offline-queue-banner');
    expect(within(banner).getByText('Выработка не принята')).toBeInTheDocument();
    expect(within(banner).getByRole('button', {name: 'Удалить запись'})).toBeInTheDocument();
  });
});

describe('T-V1-QUEUE-FLOW: ждущая и отклонённая записи одновременно', () => {
  it('строка состояния говорит и об отклонённой, и о ждущей (F-R89-STRIP-COUNTS)', async () => {
    render(<OperatorMobileApp />);
    await screen.findByRole('button', {name: 'Добавить сваю'});

    // Первая запись — обрыв связи: ложится в очередь как PENDING.
    respondCommand = () => { throw new TypeError('Failed to fetch'); };
    logProduction();
    expect(await screen.findByText('Выработка: сохранено на устройстве, отправим при связи'))
      .toBeInTheDocument();

    // Вторая запись — 409: сервер отказал по существу, запись становится FAILED,
    // а ждущая остаётся ждать. Ключ у второго нажатия новый, поэтому в очереди
    // две разные записи. Форму после постановки в очередь экран не закрывает,
    // только чистит число, — открывать её заново не нужно.
    respondCommand = () => jsonResponse({error: 'Смена уже закрыта'}, 409);
    fireEvent.change(screen.getByLabelText('Свай, шт'), {target: {value: '12'}});
    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    expect(await screen.findByText('Выработка не принята')).toBeInTheDocument();
    // Раньше строка при failed > 0 молчала о ждущей записи и писала
    // «Нужно проверить: 1» — машинист считал, что разбирать нечего.
    expect(screen.getByText('Отклонено: 1 · ещё ждёт отправки: 1 — причина отказа ниже'))
      .toBeInTheDocument();
  });
});
