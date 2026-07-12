'use client';

/**
 * Renders a `page-layout` template: visible widgets in `order`, each sized by
 * its `size`. Widget content comes from a caller-supplied catalog (already
 * bound to the page's data). Unknown/removed widget ids are skipped
 * defensively.
 */

import type { PageLayoutTemplate, WidgetSize } from './page-layout-template';

export interface RenderablePageWidget {
  id: string;
  title: string;
  render: (settings: Record<string, unknown>) => React.ReactNode;
}

// 12-column grid: size = how many tiles share a row (sm 4/row, md 3/row,
// lg 2/row on desktop; always 2/row on mobile). Tiles in one row are equal
// width and height — the earlier flex-basis layout produced ragged rows.
const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: 'lg:col-span-3',
  md: 'lg:col-span-4',
  lg: 'lg:col-span-6',
};

export function PageLayoutRenderer({
  template,
  widgets,
  className,
}: {
  template: PageLayoutTemplate;
  widgets: Record<string, RenderablePageWidget>;
  className?: string;
}) {
  const visible = [...template.widgets]
    .filter((w) => w.visible && widgets[w.id])
    .sort((a, b) => a.order - b.order);

  return (
    <div className={className ?? 'grid grid-cols-2 gap-3 lg:grid-cols-12'}>
      {visible.map((w) => (
        <div key={w.id} className={`col-span-1 ${SIZE_SPAN[w.size]} min-w-0 [&>*]:h-full`}>
          {widgets[w.id].render(w.settings ?? {})}
        </div>
      ))}
    </div>
  );
}
