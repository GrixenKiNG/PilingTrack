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

const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith('/api/operator/mobile/state')) return jsonResponse({data: workState});
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
