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

const SIZE_STYLE: Record<WidgetSize, React.CSSProperties> = {
  sm: { flexGrow: 1, flexBasis: 150, minWidth: 150 },
  md: { flexGrow: 2, flexBasis: 240, minWidth: 240 },
  lg: { flexGrow: 3, flexBasis: 340, minWidth: 340 },
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
    <div className={className ?? 'flex flex-wrap gap-3'}>
      {visible.map((w) => (
        <div key={w.id} style={SIZE_STYLE[w.size]}>
          {widgets[w.id].render(w.settings ?? {})}
        </div>
      ))}
    </div>
  );
}
