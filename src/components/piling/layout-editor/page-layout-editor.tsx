'use client';

/**
 * Configurator for a `page-layout` surface («Редактирование рабочего
 * пространства»): reorder / show-hide / resize the page's widgets, with a live
 * preview. Inline panel (lives in Settings → «Шаблоны плиток»). ADMIN-gated by
 * the caller; server also enforces ADMIN on save.
 */

import { useEffect } from 'react';
import { ArrowUp, ArrowDown, RotateCcw, Save } from 'lucide-react';
import type { PageLayoutController } from './use-page-layout-template';
import { PageLayoutRenderer, type RenderablePageWidget } from './page-layout-renderer';
import { WIDGET_SIZES, type WidgetSize } from './page-layout-template';

const SIZE_LABEL: Record<WidgetSize, string> = { sm: 'Маленький', md: 'Средний', lg: 'Большой' };

export function PageLayoutEditor({
  title,
  controller,
  widgets,
}: {
  title: string;
  controller: PageLayoutController;
  widgets: Record<string, RenderablePageWidget>;
}) {
  useEffect(() => { controller.startEditing(); /* sync draft on mount */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = [...controller.draft.widgets].sort((a, b) => a.order - b.order);

  return (
    <section aria-label={`Редактор: ${title}`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">Порядок, видимость и размер плиток на дашборде.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void controller.reset()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Сбросить
          </button>
          <button
            type="button"
            onClick={() => void controller.saveDraft()}
            disabled={!controller.dirty}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> Сохранить
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rows.map((w, index) => {
          const meta = widgets[w.id];
          return (
            <li key={w.id} className="flex items-center gap-3 p-2.5">
              <div className="flex flex-col">
                <button type="button" aria-label="Выше" disabled={index === 0} onClick={() => controller.move(w.id, -1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label="Ниже" disabled={index === rows.length - 1} onClick={() => controller.move(w.id, 1)} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              </div>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{meta?.title ?? w.id}</span>
              <select
                aria-label={`Размер: ${meta?.title ?? w.id}`}
                value={w.size}
                onChange={(e) => controller.setSize(w.id, e.target.value as WidgetSize)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {WIDGET_SIZES.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
              </select>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={w.visible} onChange={(e) => controller.setVisible(w.id, e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Показывать
              </label>
            </li>
          );
        })}
      </ul>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-500">Предпросмотр</p>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <PageLayoutRenderer template={controller.draft} widgets={widgets} />
        </div>
      </div>
    </section>
  );
}
