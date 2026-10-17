'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { RunInspection } from '@/components/piling/inspections/run-inspection';

/** `/inspections/<id>`; список, `new` и вложенные пути — не осмотр. */
const INSPECTION_HREF = /^\/inspections\/(?!new(?:[/?#]|$))([^/?#]+)$/;

export function inspectionIdFromHref(href: string | null): string | null {
  return href?.match(INSPECTION_HREF)?.[1] ?? null;
}

/**
 * Осмотр из экрана техготовности открывается поверх него, а не отдельной
 * страницей: ссылок на осмотр здесь много (журнал, доказательства готовности,
 * карточка парка), и каждая уводила бы с экрана, на котором человек работает.
 *
 * Перехват один, по клику на любую ссылку внутри слоя: новые ссылки на осмотр
 * получают это поведение сами. Ctrl/Cmd/Shift и средняя кнопка оставляют обычное
 * поведение (новая вкладка).
 */
export function InspectionLayer({ children }: { children: ReactNode }) {
  const [inspectionId, setInspectionId] = useState<string | null>(null);

  const interceptInspectionLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest('a[href]');
    const id = inspectionIdFromHref(anchor?.getAttribute('href') ?? null);
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    setInspectionId(id);
  };

  return (
    <div className="contents" onClickCapture={interceptInspectionLink}>
      {children}
      <Dialog open={inspectionId !== null} onOpenChange={(open) => { if (!open) setInspectionId(null); }}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,56rem)] max-w-none gap-0 overflow-y-auto p-0 sm:max-w-none">
          <DialogTitle className="sr-only">Осмотр</DialogTitle>
          {inspectionId && <RunInspection inspectionId={inspectionId} onExit={() => setInspectionId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
