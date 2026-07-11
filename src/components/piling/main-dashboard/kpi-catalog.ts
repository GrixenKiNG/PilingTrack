/**
 * Pure catalog for the 'main-dashboard' page-layout surface (Stage B, second
 * module): the KPI-strip widgets on /admin. No React — imported by the
 * server-side surface registry and the client renderer/editor. The dashboard
 * sections (план-факт / парк / риски) stay as-is for now.
 */

import type { PageLayoutTemplate, WidgetSize } from '@/components/piling/layout-editor/page-layout-template';

export interface MainDashboardWidgetMeta {
  id: string;
  title: string;
}

export const MAIN_DASHBOARD_WIDGETS: readonly MainDashboardWidgetMeta[] = [
  { id: 'dk-reports', title: 'Отчёты' },
  { id: 'dk-piles', title: 'Сваи' },
  { id: 'dk-drilling', title: 'Бурение' },
  { id: 'dk-downtime', title: 'Простой' },
  { id: 'dk-rigs', title: 'Установки' },
  { id: 'dk-maintenance', title: 'ТО' },
];

export const MAIN_DASHBOARD_SURFACE_ID = 'main-dashboard';

export const MAIN_DASHBOARD_WIDGET_IDS: readonly string[] = MAIN_DASHBOARD_WIDGETS.map((w) => w.id);

const DEFAULT_SIZE: WidgetSize = 'md';

export const DEFAULT_MAIN_DASHBOARD_TEMPLATE: PageLayoutTemplate = {
  version: 1,
  widgets: MAIN_DASHBOARD_WIDGETS.map((w, index) => ({
    id: w.id,
    visible: true,
    size: DEFAULT_SIZE,
    order: index,
  })),
};
