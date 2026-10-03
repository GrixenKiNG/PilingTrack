import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '../equipment-tile-template';
import { FleetDashboard } from '../fleet-dashboard';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: { role: string } | null }) => unknown) =>
    selector({ currentUser: { role: 'ADMIN' } }),
}));
vi.mock('@/components/piling/async-ui', () => ({ useMinSkeletonDuration: () => false }));
vi.mock('next/image', () => ({ default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt ?? ''} {...props} /> }));

const baseCard: FleetCard = {
  id: 'eq-1', name: 'Установка №1', model: 'Junttan', manufactureYear: 2022,
  kind: 'PILE_DRIVER', inventoryNumber: 'INV-1', serialNumber: null,
  engineHoursTotal: 100, nextMaintenanceDate: null, nextMaintenanceAtHours: 200,
  assignedSiteId: 'site-1', assignedSiteName: 'Объект №1', assignedOperatorName: 'Иванов', assignedCrewName: null,
  status: 'active', reportStatus: 'has_report', equipmentStatus: 'working', todaysReports: 1,
  todayTotals: { piles: 2, pileMeters: 20, drillingCount: 1, drillingMeters: 5, downtimeHours: 0 },
  downtimeReason: null, latestReport: null, photoUrl: null,
};

const snapshot: FleetSnapshot = {
  asOf: '2026-07-04T12:00:00.000Z',
  today: '2026-07-04',
  totals: { totalEquipment: 2, activeToday: 2, expected: 0, idle: 0, pilesToday: 5, pileMetersToday: 60, drillingToday: 10, drillingCountToday: 1, downtimeHoursToday: 0, crewsOnShiftToday: 2, operatorsOnShiftToday: 2 },
  equipment: [baseCard, { ...baseCard, id: 'eq-2', name: 'Установка №2', assignedSiteId: 'site-2', assignedSiteName: 'Объект №2', assignedOperatorName: 'Петров' }],
};

describe('FleetDashboard shared equipment template', () => {
  /** Шаблон, который «уже сохранён на сервере» к моменту отрисовки. */
  let serverTemplate: unknown;
  const savedTemplate = (template: unknown) => { serverTemplate = template; };

  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      },
    });
    window.history.replaceState({}, '', '/monitoring');
    serverTemplate = DEFAULT_EQUIPMENT_TILE_TEMPLATE;
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/monitoring/fleet')) {
        return { ok: true, json: async () => snapshot };
      }
      if (url === '/api/layout/monitoring-equipment-tile' && method === 'GET') {
        return { ok: true, json: async () => serverTemplate };
      }
      if (url === '/api/layout/monitoring-equipment-tile' && method === 'PUT') {
        serverTemplate = JSON.parse(init?.body as string);
        return { ok: true, json: async () => serverTemplate };
      }
      throw new Error(`Unexpected authFetch: ${method} ${url}`);
    });
  });

  /**
   * Следующий ответ `/api/monitoring/fleet` — ошибка, остальные ответы прежние.
   * Нужно, чтобы показать экран в состоянии сбоя: без снимка и с устаревшим.
   */
  const failFleetFetch = () => {
    const base = mocks.authFetch.getMockImplementation();
    if (!base) throw new Error('authFetch mock is not configured');
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.startsWith('/api/monitoring/fleet') ? { ok: false, json: async () => ({}) } : base(url, init));
  };

  /** Следующий ответ `/api/monitoring/fleet` — отказ с указанным кодом статуса. */
  const fleetFailsWith = (status: number) => {
    const base = mocks.authFetch.getMockImplementation();
    if (!base) throw new Error('authFetch mock is not configured');
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) =>
      url.startsWith('/api/monitoring/fleet') ? { ok: false, status, json: async () => ({}) } : base(url, init));
  };

  /** Запрос снимка обрывается исключением (таймаут AbortError или сетевая ошибка). */
  const fleetThrows = (error: unknown) => {
    const base = mocks.authFetch.getMockImplementation();
    if (!base) throw new Error('authFetch mock is not configured');
    mocks.authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/monitoring/fleet')) throw error;
      return base(url, init);
    });
  };

  it('applies one saved template to all visible equipment cards', async () => {
    // Шаблон приходит с сервера уже сохранённым: редактор переехал в
    // «Настройки → Шаблоны плиток», и на мониторинге его больше нет. Проверяем
    // то, ради чего тест и написан, — один шаблон раскрывается на все
    // видимые карточки.
    savedTemplate({
      ...DEFAULT_EQUIPMENT_TILE_TEMPLATE,
      blocks: [
        ...DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks,
        {
          id: 'text-1',
          kind: 'text' as const,
          text: 'Общий шаблон',
          x: 0,
          y: 9,
          width: 12,
          height: 2,
          visible: true,
          style: DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks[0].style,
        },
      ],
    });

    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));
    expect(screen.getAllByText('Объект №1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Объект №2').length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getAllByText('Общий шаблон')).toHaveLength(2));
  });

  it('редактора на экране мониторинга больше нет', async () => {
    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));

    // Плавающая кнопка за скрытым замком `?design=1` уехала в настройки.
    // Диспетчеру, который следит за сменой, она под руку больше не попадётся.
    expect(screen.queryByRole('button', { name: 'Редактировать шаблон' })).not.toBeInTheDocument();
  });

  /**
   * R73 №54: селекты фильтров «Объект»/«Сортировка» были 32px на телефоне —
   * диспетчер с телефона тянется пальцем к самому верху экрана. Правка только
   * на телефоне: `min-h-11 … sm:min-h-0`, на десктопе высота не меняется
   * (сброс обязателен — `min-height` сильнее `height`).
   */
  it('держит селекты фильтров не ниже 44px на телефоне (R73)', async () => {
    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));

    for (const label of ['Фильтр по объекту', 'Сортировка техники']) {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'sm:min-h-0');
    }
  });

  /**
   * R73 №54: «Повторить загрузку» — ссылка-кнопка высотой в строку текста
   * (≈20px), ниже минимума WCAG 24px. Телефон поднимает её до 44px, десктоп
   * оставляет прежней (`sm:min-h-0`).
   */
  it('держит «Повторить загрузку» не ниже 44px на телефоне (R73)', async () => {
    failFleetFetch();

    render(<FleetDashboard />);

    const retry = await screen.findByRole('button', { name: 'Повторить загрузку' });
    expect(retry).toHaveClass('inline-flex', 'min-h-11', 'items-center', 'sm:min-h-0');
  });

  /**
   * R73 №54: «Обновить» в баннере «Показан предыдущий снимок» — та же
   * ссылка-кнопка (≈20px). Она стоит в строке текста, поэтому рост до 44px
   * задан через `inline-flex items-center`, чтобы подпись осталась по центру.
   */
  it('держит «Обновить» в баннере устаревшего снимка не ниже 44px на телефоне (R73)', async () => {
    render(<FleetDashboard />);
    await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));

    // Снимок уже на экране, следующий опрос не удался — появляется баннер
    // «Показан предыдущий снимок» с кнопкой «Обновить».
    failFleetFetch();
    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Обновить' })).toHaveClass('inline-flex', 'min-h-11', 'items-center', 'sm:min-h-0');
  });

  /**
   * R101 №5: отказ сервера больше не выдаётся за «нет соединения» — код
   * статуса разбирается, сбой БД и ограничение частоты объясняются по-разному,
   * а таймаут 15 с отличается от настоящего обрыва связи.
   */
  it('называет 5xx сбоем сервера, а не отсутствием связи (R101 №5)', async () => {
    fleetFailsWith(500);

    render(<FleetDashboard />);

    expect(await screen.findByText(/Сервер мониторинга временно недоступен/)).toBeInTheDocument();
    expect(screen.queryByText(/Нет соединения с сервисом мониторинга/)).not.toBeInTheDocument();
  });

  it('отличает ограничение частоты 429 (R101 №5)', async () => {
    fleetFailsWith(429);

    render(<FleetDashboard />);

    expect(await screen.findByText(/Слишком много запросов/)).toBeInTheDocument();
  });

  it('таймаут сервера (TimeoutError) не выдаётся за обрыв сети (R101 №5)', async () => {
    fleetThrows(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));

    render(<FleetDashboard />);

    expect(await screen.findByText(/Сервер не ответил за 15 секунд/)).toBeInTheDocument();
    expect(screen.queryByText(/Нет соединения с сервисом мониторинга/)).not.toBeInTheDocument();
  });

  it('настоящий обрыв сети по-прежнему объясняется как отсутствие соединения (R101 №5)', async () => {
    fleetThrows(new TypeError('Failed to fetch'));

    render(<FleetDashboard />);

    expect(await screen.findByText(/Нет соединения с сервисом мониторинга/)).toBeInTheDocument();
  });

  /**
   * R118 №2: хвост «Повторите попытку.» был жёстким у всех отказов. Таймаут уже
   * кончается этим советом — на экране выходило «…Повторите попытку. Повторите
   * попытку.», а 401/403 советовали повторить то, что повтором не чинится.
   */
  it('не удваивает «Повторите попытку.» у таймаута (R118 №2)', async () => {
    fleetThrows(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));

    render(<FleetDashboard />);

    const text = await screen.findByText(/Сервер не ответил за 15 секунд/);
    expect(text.textContent).toBe('Сервер не ответил за 15 секунд. Повторите попытку.');
  });

  it('на 403 не советует повторить запрос (R118 №2)', async () => {
    fleetFailsWith(403);

    render(<FleetDashboard />);

    const text = await screen.findByText(/Нет доступа к мониторингу/);
    expect(text.textContent).toBe('Нет доступа к мониторингу. Обратитесь к администратору.');
  });

  /**
   * F-R118-1: подпись «Данные обновлены N назад» вычислялась один раз на рендер.
   * При потере связи опрос каждые 30 с ставит одну и ту же строку ошибки, React
   * пропускает повторный рендер (bailout) — и метка замирала на последнем
   * успешном кадре, хотя числа уже устарели. Теперь отдельный тик раз в 30 с
   * пересчитывает относительное время.
   */
  describe('F-R118-1: отметка свежести пересчитывается по таймеру', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2026-07-04T12:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('без свежих данных «Данные обновлены N назад» продолжает расти', async () => {
      render(<FleetDashboard />);
      await waitFor(() => expect(screen.getAllByTestId('equipment-tile')).toHaveLength(2));
      expect(screen.getByText(/Данные обновлены только что/)).toBeInTheDocument();

      // Сервер не отвечает: опросы «висят» и не меняют состояние панели, так что
      // пересчитать подпись может только собственный тик. Раньше она так и
      // застывала на «только что», сколько бы часов ни прошло.
      const base = mocks.authFetch.getMockImplementation();
      if (!base) throw new Error('authFetch mock is not configured');
      mocks.authFetch.mockImplementation((url: string, init?: RequestInit) =>
        url.startsWith('/api/monitoring/fleet') ? new Promise(() => {}) : base(url, init));

      await act(async () => { vi.advanceTimersByTime(120_000); });

      expect(screen.getByText(/Данные обновлены 2 мин назад/)).toBeInTheDocument();
    });
  });
});
