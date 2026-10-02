/**
 * R106 №6: в настройках «Шаблоны плиток» предпросмотр рисовался из нулей, когда
 * /api/monitoring/fleet или /api/sites/all отказали (403/5xx/сеть): «Установок 0»,
 * «Объектов 0» выглядели как реальный пустой парк. Теперь на отказе плитки
 * показываются без значений («—») и висит пояснение, а при успешной загрузке —
 * реальные числа.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));

vi.mock('@/components/piling/layout-editor/use-page-layout-template', async () => {
  const { DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE } = await import('../kpi-catalog');
  return {
    usePageLayoutTemplate: () => ({
      template: DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
      draft: DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
      editing: true,
      dirty: false,
      startEditing: () => {},
      cancelEditing: () => {},
      saveDraft: async () => {},
      reset: async () => {},
      setVisible: () => {},
      setSize: () => {},
      move: () => {},
      updateSettings: () => {},
    }),
  };
});

import { AnalyticsDashboardLayoutEditor } from '../kpi-widgets';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FLEET = {
  totals: {
    totalEquipment: 42, pilesToday: 5, pileMetersToday: 60, drillingToday: 7,
    drillingCountToday: 2, downtimeHoursToday: 1, crewsOnShiftToday: 3, operatorsOnShiftToday: 4,
  },
};

describe('AnalyticsDashboardLayoutEditor: предпросмотр при отказе источников', () => {
  beforeEach(() => { mocks.authFetch.mockReset(); });

  it('не рисует нули, показывает «—» и пояснение', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/monitoring/fleet') return json({ error: 'Доступ запрещён' }, 403);
      if (url === '/api/sites/all') return json({ error: 'Доступ запрещён' }, 403);
      return json({});
    });
    render(<AnalyticsDashboardLayoutEditor />);

    await screen.findByText('Данные парка не загрузились — плитки показаны без значений.');
    // 7 KPI-плиток каталога — все без значений.
    expect(screen.getAllByText('—')).toHaveLength(7);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('обрыв сети — тот же честный предпросмотр, без нулей', async () => {
    mocks.authFetch.mockImplementation(async () => { throw new Error('network down'); });
    render(<AnalyticsDashboardLayoutEditor />);

    await screen.findByText('Данные парка не загрузились — плитки показаны без значений.');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('успешная загрузка — реальные числа вместо заглушек', async () => {
    mocks.authFetch.mockImplementation(async (url: string) => {
      if (url === '/api/monitoring/fleet') return json(FLEET);
      if (url === '/api/sites/all') return json([{ id: 'site-1' }]);
      return json({});
    });
    render(<AnalyticsDashboardLayoutEditor />);

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.queryByText('Данные парка не загрузились — плитки показаны без значений.')).not.toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
