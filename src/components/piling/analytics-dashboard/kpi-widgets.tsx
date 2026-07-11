'use client';

/**
 * Client catalog for the 'analytics-dashboard' page-layout surface: renders
 * each KPI-tile widget from live fleet data. `AnalyticsKpiRow` renders the
 * saved layout on /admin/analytics; `AnalyticsDashboardLayoutEditor` is the
 * configurator mounted in Settings → «Шаблоны плиток».
 */

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { PageLayoutRenderer, type RenderablePageWidget } from '@/components/piling/layout-editor/page-layout-renderer';
import { PageLayoutEditor } from '@/components/piling/layout-editor/page-layout-editor';
import { usePageLayoutTemplate } from '@/components/piling/layout-editor/use-page-layout-template';
import { createPageLayoutValidator } from '@/components/piling/layout-editor/page-layout-template';
import {
  ANALYTICS_DASHBOARD_SURFACE_ID,
  ANALYTICS_KPI_WIDGET_IDS,
  DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
} from './kpi-catalog';

export interface AnalyticsKpiData {
  totalEquipment: number;
  sitesCount: number;
  pilesToday: number;
  pileMetersToday: number;
  drillingToday: number;
  downtimeHoursToday: number;
  crewsOnShiftToday: number;
  operatorsOnShiftToday: number;
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        <p className="mt-1 text-xs text-slate-400">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function buildAnalyticsKpiWidgets(d: AnalyticsKpiData): Record<string, RenderablePageWidget> {
  const tile = (id: string, title: string, value: string, hint: string): RenderablePageWidget => ({
    id,
    title,
    render: () => <KpiTile label={title} value={value} hint={hint} />,
  });
  return {
    'kpi-equipment': tile('kpi-equipment', 'Установок', String(d.totalEquipment), 'из мониторинга'),
    'kpi-sites': tile('kpi-sites', 'Объектов', String(d.sitesCount), 'активных'),
    'kpi-piles': tile('kpi-piles', 'Сваи (шт)', `${d.pilesToday} шт`, 'за сегодня'),
    'kpi-pile-meters': tile('kpi-pile-meters', 'Метры свай', `${Math.round(d.pileMetersToday)} м`, 'за сегодня'),
    'kpi-drilling': tile('kpi-drilling', 'Бурение', `${Math.round(d.drillingToday)} м`, 'за сегодня'),
    'kpi-downtime': tile('kpi-downtime', 'Простой', `${d.downtimeHoursToday} ч`, 'за сегодня'),
    'kpi-crews': tile('kpi-crews', 'Бригады', String(d.crewsOnShiftToday), 'на смене'),
    'kpi-operators': tile('kpi-operators', 'Операторы', String(d.operatorsOnShiftToday), 'на смене'),
  };
}

const validate = createPageLayoutValidator(ANALYTICS_KPI_WIDGET_IDS);

function useDashboardController() {
  return usePageLayoutTemplate({
    surfaceId: ANALYTICS_DASHBOARD_SURFACE_ID,
    defaultTemplate: DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
    validate,
    catalogIds: ANALYTICS_KPI_WIDGET_IDS,
  });
}

/** KPI row on /admin/analytics, rendered from the tenant's saved layout. */
export function AnalyticsKpiRow({ data }: { data: AnalyticsKpiData }) {
  const controller = useDashboardController();
  const widgets = buildAnalyticsKpiWidgets(data);
  return <PageLayoutRenderer template={controller.template} widgets={widgets} />;
}

/** Configurator for Settings → «Шаблоны плиток». Fetches live data for preview. */
export function AnalyticsDashboardLayoutEditor() {
  const controller = useDashboardController();
  const [data, setData] = useState<AnalyticsKpiData | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [fleetRes, sitesRes] = await Promise.all([
          authFetch('/api/monitoring/fleet'),
          authFetch('/api/sites/all'),
        ]);
        const fleet = fleetRes.ok ? await fleetRes.json() : null;
        const sites = sitesRes.ok ? await sitesRes.json() : [];
        if (!active) return;
        const t = fleet?.totals ?? {};
        setData({
          totalEquipment: t.totalEquipment ?? 0,
          sitesCount: Array.isArray(sites) ? sites.length : (sites?.sites?.length ?? 0),
          pilesToday: t.pilesToday ?? 0,
          pileMetersToday: t.pileMetersToday ?? 0,
          drillingToday: t.drillingToday ?? 0,
          downtimeHoursToday: t.downtimeHoursToday ?? 0,
          crewsOnShiftToday: t.crewsOnShiftToday ?? 0,
          operatorsOnShiftToday: t.operatorsOnShiftToday ?? 0,
        });
      } catch {
        if (active) setData(null);
      }
    })();
    return () => { active = false; };
  }, []);

  const widgets = buildAnalyticsKpiWidgets(data ?? {
    totalEquipment: 0, sitesCount: 0, pilesToday: 0, pileMetersToday: 0,
    drillingToday: 0, downtimeHoursToday: 0, crewsOnShiftToday: 0, operatorsOnShiftToday: 0,
  });

  return <PageLayoutEditor title="Дашборд аналитики — KPI" controller={controller} widgets={widgets} />;
}
