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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/use-ability', () => ({ useAbility: () => true }));
vi.mock('@/components/piling/main-dashboard/dashboard-layout', () => ({
  useMainDashboardLayout: () => ({ template: { id: 'main-dashboard', widgets: [] } }),
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