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

import { AnalyticsDashboardLayoutEditor, buildAnalyticsKpiWidgets, type AnalyticsKpiData } from '../kpi-widgets';

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

/**
 * R139 №1/№2: в одной полосе смешивались 7-дневный итог («за период») и снимок
 * парка на текущий день, а дельта «Свай»/«Бурения» считалась по метрам без
 * единицы — читалась как процент по штукам. Дневные плитки подписаны «на
 * сегодня», дельта — «м.п.».
 */
const PERIOD_DATA: AnalyticsKpiData = {
  totalEquipment: 42, sitesCount: 3, pilesToday: 5, pileMetersToday: 60,
  drillingToday: 7, drillingCountToday: 2, downtimeHoursToday: 1,
  crewsOnShiftToday: 3, operatorsOnShiftToday: 4,
  period: {
    label: 'к пред. неделе',
    meters: { value: 1200, deltaPct: 5.2 },
    piles: { value: 30, deltaPct: -3 },
    drilling: { value: 800, deltaPct: 2 },
    drillingCount: { value: 10, deltaPct: 1 },
    downtime: { value: 4.2, deltaPp: -1.1 },
  },
};

describe('buildAnalyticsKpiWidgets: период против «на сегодня» (R139 №1, №2)', () => {
  it('дельта «Свай» подписана единицей м.п.', () => {
    const w = buildAnalyticsKpiWidgets(PERIOD_DATA);
    render(<>{w['kpi-piles'].render({})}</>);
    expect(screen.getByText('м.п. +5,2% к пред. неделе')).toBeInTheDocument();
  });

  it('дельта «Бурения» подписана единицей м.п.', () => {
    const w = buildAnalyticsKpiWidgets(PERIOD_DATA);
    render(<>{w['kpi-drilling'].render({})}</>);
    expect(screen.getByText('м.п. +2% к пред. неделе')).toBeInTheDocument();
  });

  it('дневные плитки явно подписаны «на сегодня»', () => {
    const w = buildAnalyticsKpiWidgets(PERIOD_DATA);
    render(<>{w['kpi-equipment'].render({})}</>);
    render(<>{w['kpi-sites'].render({})}</>);
    render(<>{w['kpi-crews'].render({})}</>);
    render(<>{w['kpi-operators'].render({})}</>);
    // R139 №19: значение — только активные установки; №14: объекты включают закрытые.
    expect(screen.getByText('активных в парке на сегодня')).toBeInTheDocument();
    expect(screen.getByText('всего на сегодня, включая закрытые')).toBeInTheDocument();
    expect(screen.getAllByText('на смене сегодня, включая несданные смены')).toHaveLength(2);
  });

  // R139 №21: deltaPct = null (нет прошлого периода с базой) — процент исчезал, и на
  // его месте стояло «за период»: «нет базы для сравнения» выглядело как «изменений нет».
  it('нет базы для сравнения — плитка говорит об этом, а не молчит', () => {
    const noBase: AnalyticsKpiData = {
      ...PERIOD_DATA,
      period: {
        label: 'к пред. неделе',
        meters: { value: 1200, deltaPct: null },
        piles: { value: 30, deltaPct: null },
        drilling: { value: 800, deltaPct: null },
        drillingCount: { value: 10, deltaPct: null },
        downtime: { value: 4.2, deltaPp: -1.1 },
      },
    };
    const w = buildAnalyticsKpiWidgets(noBase);
    render(<>{w['kpi-piles'].render({})}</>);
    render(<>{w['kpi-drilling'].render({})}</>);
    expect(screen.getAllByText('нет данных для сравнения')).toHaveLength(2);
    expect(screen.queryByText('м.п. +5,2% к пред. неделе')).not.toBeInTheDocument();
  });
});
