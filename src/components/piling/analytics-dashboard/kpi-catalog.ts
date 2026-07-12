/**
 * Pure catalog for the 'analytics-dashboard' page-layout surface (Stage B):
 * every configurable widget (KPI tiles + the tab sections), its title and the
 * zone it renders in. No React — imported by the server-side surface registry
 * as well as the client renderer/editor.
 *
 * Tabs are kept (lazy per-tab data loading); within each zone the widgets'
 * visibility/size/order come from the saved page-layout template.
 */

import type { PageLayoutTemplate, WidgetSize } from '@/components/piling/layout-editor/page-layout-template';

/** Where a widget renders on the analytics page. */
export type AnalyticsZone = 'kpi' | 'overview' | 'operators' | 'trends' | 'maintenance';

export interface AnalyticsWidgetMeta {
  id: string;
  title: string;
  zone: AnalyticsZone;
  defaultSize: WidgetSize;
}

/** Order here defines the default order + the configurator listing. */
export const ANALYTICS_DASHBOARD_WIDGETS: readonly AnalyticsWidgetMeta[] = [
  { id: 'kpi-equipment', title: 'Установок', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-sites', title: 'Объектов', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-piles', title: 'Сваи (шт)', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-pile-meters', title: 'Метры свай', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-drilling', title: 'Бурение', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-downtime', title: 'Простой', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-crews', title: 'Бригады', zone: 'kpi', defaultSize: 'sm' },
  { id: 'kpi-operators', title: 'Операторы', zone: 'kpi', defaultSize: 'sm' },
  { id: 'chart-dynamics', title: 'Динамика погонных метров', zone: 'overview', defaultSize: 'lg' },
  { id: 'usage-equipment', title: 'Использование установок', zone: 'overview', defaultSize: 'md' },
  { id: 'rating-sites', title: 'Рейтинг объектов', zone: 'overview', defaultSize: 'md' },
  { id: 'chart-operators', title: 'Топ-10 по сваям (график)', zone: 'operators', defaultSize: 'lg' },
  { id: 'table-operators', title: 'Сводка по операторам', zone: 'operators', defaultSize: 'lg' },
  { id: 'chart-trends', title: 'Тренд за 8 недель', zone: 'trends', defaultSize: 'lg' },
  { id: 'kpi-maintenance', title: 'KPI надёжности ТО', zone: 'maintenance', defaultSize: 'lg' },
  { id: 'table-problem-rigs', title: 'Топ проблемных установок', zone: 'maintenance', defaultSize: 'lg' },
];

export const ANALYTICS_DASHBOARD_SURFACE_ID = 'analytics-dashboard';

export const ANALYTICS_DASHBOARD_WIDGET_IDS: readonly string[] = ANALYTICS_DASHBOARD_WIDGETS.map((w) => w.id);

/** Backward-compatible alias (KPI-only ids), kept for existing imports. */
export const ANALYTICS_KPI_WIDGET_IDS: readonly string[] = ANALYTICS_DASHBOARD_WIDGETS
  .filter((w) => w.zone === 'kpi')
  .map((w) => w.id);

export function analyticsWidgetIdsByZone(zone: AnalyticsZone): string[] {
  return ANALYTICS_DASHBOARD_WIDGETS.filter((w) => w.zone === zone).map((w) => w.id);
}

export const DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE: PageLayoutTemplate = {
  version: 1,
  widgets: ANALYTICS_DASHBOARD_WIDGETS.map((w, index) => ({
    id: w.id,
    visible: true,
    size: w.defaultSize,
    order: index,
  })),
};
