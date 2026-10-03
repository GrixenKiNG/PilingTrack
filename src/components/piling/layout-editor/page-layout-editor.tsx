'use client';

/**
 * Configurator for a `page-layout` surface («Редактирование рабочего
 * пространства»): reorder / show-hide / resize the page's widgets, with a live
 * preview. Inline panel (lives in Settings → «Шаблоны плиток»). ADMIN-gated by
 * the caller; server also enforces ADMIN on save.
 */

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, RotateCcw, Save } from '@/components/piling/icons/unified-icons';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';
import type { PageLayoutController } from './use-page-layout-template';
import { LAYOUT_LOAD_FAILED_MESSAGE } from './use-layout-template';
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

  // Пока есть несохранённые правки, предупреждаем при закрытии/перезагрузке
  // вкладки: смена дашборда/вкладки в Настройках иначе молча теряет черновик
  // (F-R108-2).
  useEffect(() => {
    if (!controller.editing || !controller.dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [controller.editing, controller.dirty]);

  const rows = [...controller.draft.widgets].sort((a, b) => a.order - b.order);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <section aria-label={`Редактор: ${title}`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">Порядок, видимость и размер плиток на дашборде.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Сбросить
          </button>
          <button
            type="button"
            onClick={() => void controller.saveDraft()}
            disabled={!controller.dirty || controller.loadFailed}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-info-strong px-3 text-xs font-semibold text-white hover:bg-info-strong disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> Сохранить
          </button>
        </div>
      </div>

      {controller.loadFailed && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive-strong">
          {LAYOUT_LOAD_FAILED_MESSAGE}
        </p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {rows.map((w, index) => {
          const meta = widgets[w.id];
          return (
            <li key={w.id} className="flex items-center gap-3 p-2.5">
              <div className="flex flex-col">
                <button type="button" aria-label="Выше" disabled={index === 0} onClick={() => controller.move(w.id, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label="Ниже" disabled={index === rows.length - 1} onClick={() => controller.move(w.id, 1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              </div>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{meta?.title ?? w.id}</span>
              <select
                aria-label={`Размер: ${meta?.title ?? w.id}`}
                value={w.size}
                onChange={(e) => controller.setSize(w.id, e.target.value as WidgetSize)}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
              >
                {WIDGET_SIZES.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
              </select>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={w.visible} onChange={(e) => controller.setVisible(w.id, e.target.checked)} className="h-4 w-4 rounded border-border" />
                Показывать
              </label>
            </li>
          );
        })}
      </ul>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Предпросмотр</p>
        <div className="rounded-xl border border-border bg-muted p-3">
          <PageLayoutRenderer template={controller.draft} widgets={widgets} />
        </div>
      </div>

      <ConfirmActionDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Сбросить раскладку?"
        description="Сохранённая раскладка будет удалена, вернуть её не получится. Показана будет стандартная раскладка."
        confirmLabel="Сбросить раскладку"
        onConfirm={() => { setConfirmReset(false); void controller.reset(); }}
      />
    </section>
  );
}
