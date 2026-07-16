'use client';

/**
 * Shared page-layout controller + Settings configurator for the 'main-dashboard'
 * surface (KPI strip on /admin). The live KPI tiles render inside
 * admin-dashboard (they need computed kpis); here the configurator shows
 * labelled placeholders.
 */

import { PageLayoutEditor } from '@/components/piling/layout-editor/page-layout-editor';
import { usePageLayoutTemplate, type PageLayoutController } from '@/components/piling/layout-editor/use-page-layout-template';
import { createPageLayoutValidator } from '@/components/piling/layout-editor/page-layout-template';
import type { RenderablePageWidget } from '@/components/piling/layout-editor/page-layout-renderer';
import {
  MAIN_DASHBOARD_SURFACE_ID,
  MAIN_DASHBOARD_WIDGETS,
  MAIN_DASHBOARD_WIDGET_IDS,
  DEFAULT_MAIN_DASHBOARD_TEMPLATE,
} from './kpi-catalog';

const validate = createPageLayoutValidator(MAIN_DASHBOARD_WIDGET_IDS);

export function useMainDashboardLayout(): PageLayoutController {
  return usePageLayoutTemplate({
    surfaceId: MAIN_DASHBOARD_SURFACE_ID,
    defaultTemplate: DEFAULT_MAIN_DASHBOARD_TEMPLATE,
    validate,
    catalogIds: MAIN_DASHBOARD_WIDGET_IDS,
  });
}

function placeholders(): Record<string, RenderablePageWidget> {
  const out: Record<string, RenderablePageWidget> = {};
  for (const w of MAIN_DASHBOARD_WIDGETS) {
    out[w.id] = {
      id: w.id,
      title: w.title,
      render: () => (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm font-medium text-slate-600">{w.title}</div>
      ),
    };
  }
  return out;
}

export function MainDashboardLayoutEditor() {
  const controller = useMainDashboardLayout();
  return <PageLayoutEditor title="Главный дашборд — KPI" controller={controller} widgets={placeholders()} />;
}
