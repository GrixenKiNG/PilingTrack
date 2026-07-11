/**
 * Pure catalog for the 'analytics-dashboard' page-layout surface (Stage B):
 * the KPI-tile widget ids and the default layout. No React — imported by the
 * server-side surface registry as well as the client renderer/editor.
 *
 * First increment covers the KPI row (which tiles show, order, size). The
 * tabbed chart/table sections below stay as-is and can become widgets later.
 */

import type { PageLayoutTemplate, WidgetSize } from '@/components/piling/layout-editor/page-layout-template';

export interface KpiWidgetMeta {
  id: string;
  title: string;
}

/** Order here defines the default order + the configurator listing. */
export const ANALYTICS_KPI_WIDGETS: readonly KpiWidgetMeta[] = [
  { id: 'kpi-equipment', title: 'Установок' },
  { id: 'kpi-sites', title: 'Объектов' },
  { id: 'kpi-piles', title: 'Сваи (шт)' },
  { id: 'kpi-pile-meters', title: 'Метры свай' },
  { id: 'kpi-drilling', title: 'Бурение' },
  { id: 'kpi-downtime', title: 'Простой' },
  { id: 'kpi-crews', title: 'Бригады' },
  { id: 'kpi-operators', title: 'Операторы' },
];

export const ANALYTICS_DASHBOARD_SURFACE_ID = 'analytics-dashboard';

export const ANALYTICS_KPI_WIDGET_IDS: readonly string[] = ANALYTICS_KPI_WIDGETS.map((w) => w.id);

const DEFAULT_SIZE: WidgetSize = 'sm';

export const DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE: PageLayoutTemplate = {
  version: 1,
  widgets: ANALYTICS_KPI_WIDGETS.map((w, index) => ({
    id: w.id,
    visible: true,
    size: DEFAULT_SIZE,
    order: index,
  })),
};
