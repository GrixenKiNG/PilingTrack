/**
 * F-R109-1: сбой выборки аналитики объясняется только в своём блоке
 * («План-факт по объектам»), а не заменяет весь дашборд. 403 — отказ в правах
 * («Нет прав на аналитику»), прочее — «Не удалось загрузить, обновите
 * страницу». Парк, ТО и риски приходят отдельными выборками и остаются
 * на экране.
 *
 * До правки любой не-ok ответ аналитики показывал один текст про сеть и
 * сносил весь экран — эти тесты падали.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  // Плитки KPI рендерит PageLayoutRenderer по раскладке; по умолчанию её нет,
  // отдельные наборы включаются в тестах (F-R127 №2).
  layoutWidgets: [] as { id: string; visible: boolean; size: string; order: number }[],
}));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/use-ability', () => ({ useAbility: () => true }));
vi.mock('@/components/piling/main-dashboard/dashboard-layout', () => ({
  useMainDashboardLayout: () => ({ template: { id: 'main-dashboard', version: 1, widgets: mocks.layoutWidgets } }),
}));

import { AdminDashboard } from '../admin-dashboard';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fleet = {
  totals: { totalEquipment: 0, activeToday: 0, expected: 0, idle: 0, downtimeHoursToday: 0, crewsOnShiftToday: 0 },
  equipment: [],
};

/** Остальные выборки дашборда отвечают успешно — падает только аналитика. */
function mockFetch(analyticsResponse: Response) {
  mocks.authFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/analytics/sites')) return Promise.resolve(analyticsResponse);
    if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json(fleet));
    if (url.startsWith('/api/maintenance')) return Promise.resolve(json({ records: [] }));
    if (url.startsWith('/api/reports/recent')) return Promise.resolve(json({ reports: [] }));
    if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
    return Promise.resolve(json({}));
  });
}

describe('AdminDashboard: сбой аналитики не уносит весь дашборд (F-R109-1)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('403 объясняет отсутствие прав и оставляет остальные блоки', async () => {
    mockFetch(json({ error: 'Доступ запрещён' }, 403));
    render(<AdminDashboard />);

    expect(await screen.findByText('Нет прав на аналитику')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить, обновите страницу')).not.toBeInTheDocument();
    // Блоки из отдельных выборок остались на экране.
    expect(screen.getByText('Дашборд')).toBeInTheDocument();
    expect(screen.getByText('Парк установок')).toBeInTheDocument();
    expect(screen.getByText('Риски дня')).toBeInTheDocument();
  });

  it('5xx показывает «Не удалось загрузить, обновите страницу» в своём блоке', async () => {
    mockFetch(json({ error: 'Ошибка сервера' }, 500));
    render(<AdminDashboard />);

    expect(await screen.findByText('Не удалось загрузить, обновите страницу')).toBeInTheDocument();
    expect(screen.queryByText('Нет прав на аналитику')).not.toBeInTheDocument();
    expect(screen.getByText('Дашборд')).toBeInTheDocument();
  });

  it('успешная загрузка аналитики не показывает ни одного из сообщений об ошибке', async () => {
    mockFetch(json({ analytics: [] }));
    render(<AdminDashboard />);

    expect(await screen.findByText('Для выбранного периода нет объектов с планом')).toBeInTheDocument();
    expect(screen.queryByText('Нет прав на аналитику')).not.toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить, обновите страницу')).not.toBeInTheDocument();
  });
});

/**
 * F-R126-2: в секции «Парк установок» плитка шире колонки — прямые потомки
 * кнопки `div.truncate` (white-space: nowrap) задавали её min-content ширину
 * по длине текста, а `Section` с `overflow-hidden` срезал правый край вместе с
 * бейджем статуса («Требует ТО», «Ждём отчёт»). На 375 px диспетчер не видел,
 * какую установку отправлять на ТО. Правка — `[&>*]:min-w-0` на сетке плиток,
 * как на соседней сетке план-факта.
 */
describe('AdminDashboard: плитки парка не шире колонки (F-R126-2)', () => {
  const fleetWithRig = {
    totals: { ...fleet.totals, totalEquipment: 1, expected: 1 },
    equipment: [{
      id: 'eq-1', name: 'СП-49', model: 'Liebherr LRH 100', status: 'expected' as const,
      assignedSiteName: 'Объект №1', assignedOperatorName: 'Иванов И.', assignedCrewName: 'Бригада №1',
      engineHoursTotal: 1200, nextMaintenanceAtHours: 1250,
      todayTotals: null, latestReport: null,
    }],
  };

  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/analytics/sites')) return Promise.resolve(json({ analytics: [] }));
      if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json(fleetWithRig));
      if (url.startsWith('/api/maintenance')) return Promise.resolve(json({ records: [] }));
      if (url.startsWith('/api/reports/recent')) return Promise.resolve(json({ reports: [] }));
      if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
      return Promise.resolve(json({}));
    });
  });

  it('сетка плиток установок даёт плиткам min-w-0 — бейдж статуса не уходит за край', async () => {
    render(<AdminDashboard />);

    // Плитка установки с бейджем статуса отрисовалась.
    expect(await screen.findByText('Ждём отчёт')).toBeInTheDocument();

    const grid = screen.getByText('Ждём отчёт').closest('div.grid');
    expect(grid).toHaveClass('[&>*]:min-w-0');
  });
});

/**
 * F-R109-2: справочник объектов читался один раз при монтировании, и при сбое
 * `/api/sites/all` блок оставался пустым навсегда — фильтр «Объект» выглядел
 * как «объектов в системе нет». Теперь в блоке видно «Объекты не загрузились»
 * и кнопка «Повторить» перезапрашивает список.
 */
describe('AdminDashboard: сбой справочника объектов повторяется (F-R109-2)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('сбой /api/sites/all → «Объекты не загрузились»; «Повторить» перечитывает список', async () => {
    let sitesCalls = 0;
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/analytics/sites')) return Promise.resolve(json({ analytics: [] }));
      if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json(fleet));
      if (url.startsWith('/api/maintenance')) return Promise.resolve(json({ records: [] }));
      if (url.startsWith('/api/reports/recent')) return Promise.resolve(json({ reports: [] }));
      if (url.startsWith('/api/sites/all')) {
        sitesCalls += 1;
        return Promise.resolve(
          sitesCalls === 1
            ? json({ error: 'Ошибка сервера' }, 500)
            : json({ sites: [{ id: 's1', name: 'Объект №1' }] }),
        );
      }
      return Promise.resolve(json({}));
    });
    render(<AdminDashboard />);

    expect(await screen.findByText('Объекты не загрузились')).toBeInTheDocument();
    // Справочник не прочитан — в фильтре только «Все объекты».
    expect(screen.queryByText('Объект №1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(await screen.findByText('Объект №1')).toBeInTheDocument();
    expect(screen.queryByText('Объекты не загрузились')).not.toBeInTheDocument();
  });
});

/**
 * F-R109-3: на панели не было ни одной отметки свежести — диспетчер держит
 * /admin открытым часами и не отличает свежие данные от устаревших. Теперь под
 * шапкой строка «Обновлено в ЧЧ:ММ» — местное время последней успешной загрузки
 * аналитики. При сбое аналитики отметки нет (время нечего помечать).
 */
describe('AdminDashboard: отметка свежести аналитики (F-R109-3)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 3, 14, 5));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('после успешной загрузки аналитики под шапкой «Обновлено в 14:05»', async () => {
    mockFetch(json({ analytics: [] }));
    render(<AdminDashboard />);

    expect(await screen.findByText('Обновлено в 14:05')).toBeInTheDocument();
  });

  it('при сбое аналитики отметки свежести нет', async () => {
    mockFetch(json({ error: 'Ошибка сервера' }, 500));
    render(<AdminDashboard />);

    expect(await screen.findByText('Не удалось загрузить, обновите страницу')).toBeInTheDocument();
    expect(screen.queryByText(/^Обновлено в /)).not.toBeInTheDocument();
  });
});

/**
 * F-R127 №1/№2. Пустая система: админ после входа видел только нули и два
 * пустых блока, без единого слова о том, с чего начать. Теперь на пустой базе
 * (аналитика успешна, объектов нет, парк пуст) виден блок «С чего начать» с
 * порядком заполнения, а нулевые плитки читаются как «нет данных», а не как
 * измеренный ноль.
 */
describe('AdminDashboard: пустая система — первый шаг и «нет данных» (F-R127)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.layoutWidgets = [
      { id: 'dk-reports', visible: true, size: 'md', order: 0 },
      { id: 'dk-piles', visible: true, size: 'md', order: 1 },
      { id: 'dk-drilling', visible: true, size: 'md', order: 2 },
      { id: 'dk-downtime', visible: true, size: 'md', order: 3 },
      { id: 'dk-rigs', visible: true, size: 'md', order: 4 },
      { id: 'dk-maintenance', visible: true, size: 'md', order: 5 },
    ];
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/analytics/sites')) return Promise.resolve(json({ analytics: [] }));
      if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json(fleet));
      if (url.startsWith('/api/maintenance')) return Promise.resolve(json({ records: [] }));
      if (url.startsWith('/api/reports/recent')) return Promise.resolve(json({ reports: [] }));
      if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
      return Promise.resolve(json({}));
    });
  });

  it('показывает «С чего начать» с шагами, ведущими в разделы', async () => {
    render(<AdminDashboard />);

    expect(await screen.findByText('С чего начать')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Справочники' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Объекты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Бригады' })).toBeInTheDocument();
  });

  it('нулевые плитки подписаны «нет установок» / «данных пока нет», а не нулями', async () => {
    render(<AdminDashboard />);

    expect((await screen.findAllByText('нет установок')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('данных пока нет')).length).toBeGreaterThan(0);
    // «0 / 0» и «из 0» как факт на пустой базе не показываются.
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
    expect(screen.queryByText(/из 0/)).not.toBeInTheDocument();
  });
});