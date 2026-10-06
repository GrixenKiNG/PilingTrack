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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/use-ability', () => ({ useAbility: () => true }));
vi.mock('@/components/piling/main-dashboard/dashboard-layout', () => ({
  useMainDashboardLayout: () => ({ template: { id: 'main-dashboard', widgets: [] } }),
}));

vi.mock('@/components/piling/layout-editor/page-layout-renderer', () => ({
  PageLayoutRenderer: ({ widgets }: { widgets: Record<string, { render: () => import('react').ReactNode }> }) => (
    <section aria-label="KPI">{Object.entries(widgets).map(([id, widget]) => <div key={id}>{widget.render()}</div>)}</section>
  ),
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

  it.each([403, 500])('F6 review10: failed analytics %s marks production KPI unavailable without false zeros', async status => {
    mockFetch(json({ error: 'failure' }, status)); render(<AdminDashboard />);
    await screen.findByText(status === 403 ? 'Нет прав на аналитику' : 'Не удалось загрузить, обновите страницу');
    const kpi = within(screen.getByRole('region', { name: 'KPI' }));
    expect(kpi.getAllByText('Данные не загрузились')).toHaveLength(3);
    expect(kpi.getAllByText('—')).toHaveLength(3);
    expect(kpi.getByText('0 / 0')).toBeInTheDocument(); // independent live fleet metric remains visible
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

it('D6: поздний JSON прежнего запроса объектов не перезаписывает результат повтора', async () => {
  mocks.authFetch.mockReset();
  let finishOld: (value: unknown) => void = () => { throw new Error('old JSON not started'); };
  const oldJson = new Promise((resolve) => { finishOld = resolve; });
  const oldResponse = json({}); vi.spyOn(oldResponse, 'json').mockReturnValue(oldJson);
  let calls = 0;
  mocks.authFetch.mockImplementation((url: string) => {
    if (url.startsWith('/api/sites/all')) {
      calls += 1;
      return Promise.resolve(calls === 1 ? oldResponse : json({ sites: [{ id: 'fresh', name: 'Свежий объект' }] }));
    }
    if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json(fleet));
    if (url.startsWith('/api/maintenance')) return Promise.resolve(json({ records: [] }));
    if (url.startsWith('/api/reports/recent')) return Promise.resolve(json({ reports: [] }));
    return Promise.resolve(json({ analytics: [] }));
  });
  render(<AdminDashboard />);
  await waitFor(() => expect(oldResponse.json).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole('button', { name: 'Обновить дашборд' }));
  expect(await screen.findByText('Свежий объект')).toBeInTheDocument();
  await act(async () => { finishOld({ sites: [{ id: 'old', name: 'Прежний объект' }] }); });
  expect(screen.getByText('Свежий объект')).toBeInTheDocument();
  expect(screen.queryByText('Прежний объект')).not.toBeInTheDocument();
});
