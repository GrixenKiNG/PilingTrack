import type * as React from 'react';
import { type HistoryEntry, type LengthConfirmState } from "./admin-dictionaries-support";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface DictionaryResizeHandleProps {
  startResize: (event: React.MouseEvent) => void;
  setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
  panelWidth: number;
}

export function DictionaryResizeHandle({ startResize, setPanelWidth, panelWidth }: DictionaryResizeHandleProps) {
  return (
<div
          onMouseDown={startResize}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 16;
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setPanelWidth((width) => Math.min(720, width + step));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setPanelWidth((width) => Math.max(320, width - step));
            } else if (event.key === 'Home') {
              event.preventDefault();
              setPanelWidth(320);
            } else if (event.key === 'End') {
              event.preventDefault();
              setPanelWidth(720);
            }
          }}
          role="separator"
          aria-label="Изменить ширину панели сведений"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={720}
          aria-valuenow={panelWidth}
          tabIndex={0}
          title="Потяните, чтобы изменить ширину"
          className="absolute -left-2.5 top-0 z-10 hidden h-full w-2.5 cursor-col-resize rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 lg:block"
        >
          <div className="mx-auto h-full w-px bg-slate-300 transition-colors" />
        </div>
  );
}

interface DictionaryHistoryPanelProps {
  historyFailed: boolean;
  setHistoryAttempt: React.Dispatch<React.SetStateAction<number>>;
  history: HistoryEntry[] | null;
}

export function DictionaryHistoryPanel({ historyFailed, setHistoryAttempt, history }: DictionaryHistoryPanelProps) {
  return (
<div className="mt-4 text-sm text-muted-foreground">
            {historyFailed ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="font-medium text-destructive-strong">Журнал изменений не загрузился</p>
              <p className="text-muted-foreground">История этого значения не показана. Это не значит, что изменений не было.</p>
              <Button variant="outline" className="min-h-11" onClick={() => setHistoryAttempt((n) => n + 1)}>Повторить</Button>
            </div>
              : history === null ? <p className="py-6 text-center text-muted-foreground">Загрузка истории…</p>
              : history.length === 0 ? <p className="py-6 text-center text-muted-foreground">Записей аудита по элементу нет.</p>
              : <ul className="space-y-3">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-border p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-foreground">{entry.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{entry.at}</span>
                      </div>
                      {entry.meta && <p className="mt-0.5 text-xs text-muted-foreground max-sm:text-sm">{entry.meta}</p>}
                      {entry.changes && entry.changes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                          {entry.changes.map((change, index) => (
                            <li key={index}>{change.label}: <s className="text-muted-foreground">{change.before}</s> → <b className="text-foreground">{change.after}</b></li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>}
          </div>
  );
}

interface DictionaryLengthConfirmationProps {
  lengthConfirm: LengthConfirmState | null;
  setLengthConfirm: React.Dispatch<React.SetStateAction<LengthConfirmState | null>>;
  formatMetres: (lengthMm: number | null | undefined) => string;
  saving: boolean;
  savePanel: (confirmed?: boolean) => Promise<void>;
  saveLength: (confirmed?: boolean) => Promise<void>;
}

export function DictionaryLengthConfirmation({ lengthConfirm, setLengthConfirm, formatMetres, saving, savePanel, saveLength }: DictionaryLengthConfirmationProps) {
  return (
<Dialog open={lengthConfirm !== null} onOpenChange={(open) => !open && setLengthConfirm(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Пересчитать прошлые отчёты?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground">
              «{lengthConfirm?.item.name}»: длина {formatMetres(lengthConfirm?.item.lengthMm) || '—'} м → <b>{formatMetres(lengthConfirm?.lengthMm)} м</b>.
            </p>
            <p>
              Погонные метры нигде не хранятся: их считают от длины марки при каждом открытии отчёта,
              аналитики, сводки за период и при печати PDF. Новая длина изменит эти цифры и за прошлые
              периоды: отчётов — {lengthConfirm?.item.reportCount}, планов — {lengthConfirm?.item.planCount}.
            </p>
            <p>У марки одна длина: прежнее значение не сохранится, старые отчёты не останутся с прежними метрами.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLengthConfirm(null)}>Отмена</Button>
            <Button
              disabled={saving}
              className="bg-warning-strong text-white hover:bg-warning-strong"
              onClick={() => {
                const source = lengthConfirm?.source;
                setLengthConfirm(null);
                if (source === 'panel') void savePanel(true); else void saveLength(true);
              }}
            >
              Изменить длину
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

export function startDictionaryResize(event: React.MouseEvent, panelWidth: number, setPanelWidth: React.Dispatch<React.SetStateAction<number>>) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = panelWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setPanelWidth(Math.min(720, Math.max(320, startW + (startX - moveEvent.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
