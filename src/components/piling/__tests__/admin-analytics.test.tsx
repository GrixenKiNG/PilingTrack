/**
 * W52: экран /admin/analytics (548 строк) не был покрыт ни одним тестом —
 * включая ветки 401, внесённые этой веткой (overview, тренды, KPI). Здесь
 * смоук рендера и проверка, что истёкшая сессия называется своим текстом, а
 * пустой период честно объясняется. Тяжёлые части (KPI-плитки, графики)
 * подменены заглушками: проверяется поведение самого экрана, а не recharts.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('@/components/piling/analytics-dashboard/kpi-widgets', () => ({
  useAnalyticsDashboardLayout: () => ({ template: { id: 'analytics-dashboard', version: 1, widgets: [] } }),
  buildAnalyticsKpiWidgets: () => ({}),
}));
vi.mock('@/components/piling/layout-editor/page-layout-renderer', () => ({
  PageLayoutRenderer: () => null,
}));

import { AdminAnalytics } from '../admin-analytics';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const emptyOverview = {
  period: { from: '2026-10-01', to: '2026-10-07', days: 7 },
  kpi: {
    meters: { value: 0, deltaPct: null },
    piles: { value: 0, deltaPct: null },
    drilling: { value: 0, deltaPct: null },
    drillingCount: { value: 0, deltaPct: null },
    downtimePct: { value: null, deltaPp: null },
  },
  daily: [],
  equipmentUsage: [],
  siteRating: [],
  operators: [],
};

const urls = () => mocks.authFetch.mock.calls.map(([url]) => String(url));

describe('AdminAnalytics — смоук и тексты отказов (W52)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('рендерится и подписан тремя вкладками', async () => {
    mocks.authFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/sites/all')) return Promise.resolve(json({ sites: [] }));
      if (url.startsWith('/api/monitoring/fleet')) return Promise.resolve(json({ totals: {} }));
      return Promise.resolve(json(emptyOverview));
    });

    render(<AdminAnalytics />);

    expect(await screen.findByRole('heading', { name: 'Аналитика' })).toBeInTheDocument();
    for (const tab of ['Операторы', 'Тренды по объектам', 'Надёжность ТО']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    expect(document.title).toBe('Аналитика — PilingTrack');
    // Период пуст → экран объясняет это, а не рисует нули как факт.
    expect(await screen.findByText(/За выбранный период нет отчётов/)).toBeInTheDocument();
  });

  it('401 на всех источниках → «Сессия истекла — войдите снова.» на каждой вкладке', async () => {
    mocks.authFetch.mockImplementation(() => Promise.resolve(json({ error: 'Unauthorized' }, 401)));

    render(<AdminAnalytics />);

    expect(await screen.findByText('Сессия истекла — войдите снова.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Тренды по объектам' }));
    await waitFor(() => expect(urls().some((u) => u.includes('/api/admin/analytics/site-weekly-trend'))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Надёжность ТО' }));
    await waitFor(() => expect(urls().some((u) => u.includes('/api/maintenance/kpi'))).toBe(true));

    // Вкладки взаимоисключающие: на экране разом баннер обзора и баннер
    // активной вкладки — оба с текстом про истёкшую сессию.
    expect((await screen.findAllByText('Сессия истекла — войдите снова.')).length).toBeGreaterThanOrEqual(2);
  });
});
