import { describe, it, expect } from 'vitest';
import {
  createPageLayoutValidator,
  type PageLayoutTemplate,
} from '@/components/piling/layout-editor/page-layout-template';
import {
  ANALYTICS_KPI_WIDGET_IDS,
  DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
} from '@/components/piling/analytics-dashboard/kpi-catalog';

const validate = createPageLayoutValidator(ANALYTICS_KPI_WIDGET_IDS);

describe('page-layout validator', () => {
  it('accepts the shipped analytics-dashboard default', () => {
    expect(validate(DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE)).toBeTruthy();
    expect(DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE.widgets.length).toBe(ANALYTICS_KPI_WIDGET_IDS.length);
  });

  it('rejects an unknown widget id (catalog is the allow-list)', () => {
    const bad: PageLayoutTemplate = { version: 1, widgets: [{ id: 'kpi-nope', visible: true, size: 'sm', order: 0 }] };
    expect(validate(bad)).toBeNull();
  });

  it('rejects a bad size and duplicate ids', () => {
    expect(validate({ version: 1, widgets: [{ id: 'kpi-piles', visible: true, size: 'huge', order: 0 }] })).toBeNull();
    expect(validate({ version: 1, widgets: [
      { id: 'kpi-piles', visible: true, size: 'sm', order: 0 },
      { id: 'kpi-piles', visible: false, size: 'md', order: 1 },
    ] })).toBeNull();
  });

  it('rejects wrong version / shape', () => {
    expect(validate({ version: 2, widgets: [] })).toBeNull();
    expect(validate({ widgets: [] })).toBeNull();
    expect(validate(null)).toBeNull();
  });
});
