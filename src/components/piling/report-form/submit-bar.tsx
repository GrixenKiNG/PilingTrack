'use client';

import { Send, AlertTriangle, Loader2 } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';

interface SubmitBarProps {
  totalPiles: number;
  totalPileMeters: number;
  totalDrillingCount: number;
  totalMeters: number;
  totalDowntime: number;
  hasDowntime: boolean;
  selectedSiteId: string;
  hasEntries: boolean;
  submitting: boolean;
  onSubmit: () => void;
}

export function SubmitBar({
  totalPiles, totalPileMeters, totalDrillingCount, totalMeters, totalDowntime, hasDowntime,
  selectedSiteId, hasEntries, submitting, onSubmit,
}: SubmitBarProps) {
  const showHint = !submitting && (!selectedSiteId || !hasEntries);

  return (
    <>
      {hasEntries && (
        <Card className="bg-slate-900 text-white border-0">
          <CardContent className="p-4">
            <h3 className="text-xs font-medium text-slate-400 mb-3">Итого за смену</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-lg font-bold font-mono tabular-nums">{totalPiles} шт. / {formatNumber(totalPileMeters)} м.п.</p>
                <p className="text-3xs text-slate-400">Сваи, шт. / м.п.</p>
              </div>
              <div>
                <p className="text-lg font-bold font-mono tabular-nums">{totalDrillingCount} шт. / {formatNumber(totalMeters)} м.п.</p>
                <p className="text-3xs text-slate-400">Бурение, шт. / м.п.</p>
              </div>
              {hasDowntime && (
                <div>
                  <p className="text-lg font-bold font-mono tabular-nums text-amber-400">{formatNumber(totalDowntime)} ч</p>
                  <p className="text-3xs text-slate-400">Простой</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t px-4 py-3 pb-safe">
        {showHint && (
          <div className="flex items-center gap-1.5 mb-2 justify-center">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs text-amber-600 font-medium">
              {!selectedSiteId ? 'Сначала выберите объект выше' : 'Добавьте хотя бы одну сваю, бурение или простой'}
            </p>
          </div>
        )}
        <button onClick={onSubmit} disabled={submitting || !selectedSiteId || !hasEntries}
          className={cn(
            'w-full h-14 rounded-lg font-semibold text-base flex items-center justify-center transition-all',
            submitting ? 'bg-orange-400 text-white cursor-wait'
              : (!selectedSiteId || !hasEntries) ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-orange-500 hover:bg-orange-600 text-white active:scale-[0.98]'
          )}>
          {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Отправка...</>
            : <><Send className="w-5 h-5 mr-2" />Отправить отчёт</>}
        </button>
      </div>
    </>
  );
}
