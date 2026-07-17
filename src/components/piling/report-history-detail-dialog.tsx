'use client';

/**
 * Диалог деталей отчёта в «Моих отчётах» оператора: смена, сваи, бурение,
 * простои + переход в PDF. Выделено из report-history.tsx (аудит A-8).
 */

import { Clock, Drill, Eye, HardHat, Loader2 } from '@/components/piling/icons/unified-icons';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import type { ReportDTO } from '@/lib/types';

export function ReportHistoryDetailDialog({
  report,
  loading,
  onClose,
  onPreviewPdf,
  formatDate,
  formatLastEditor,
}: {
  report: ReportDTO | null;
  loading: boolean;
  onClose: () => void;
  onPreviewPdf: (reportId: string) => void;
  formatDate: (dateStr: string) => string;
  formatLastEditor: (report: ReportDTO) => string;
}) {
  return (
    <Dialog
      open={!!report || loading}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar">
        <DialogTitle className="sr-only">
          {report ? `Отчёт от ${formatDate(report.date)}` : 'Загрузка отчёта'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {report ? `Детали отчёта за ${formatDate(report.date)}` : 'Загрузка данных отчёта'}
        </DialogDescription>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : report ? (
          <>
            <div className="flex items-center justify-between">
              <DialogHeader>
                <div className="text-base font-semibold">Отчёт от {formatDate(report.date)}</div>
              </DialogHeader>
              <button
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- reportId is set for every persisted report shown here
                onClick={() => onPreviewPdf(report.reportId!)}
                className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                Предпросмотр PDF
              </button>
            </div>

            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Объект</p>
                  <p className="font-medium">{report.site.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Статус</p>
                  <Badge
                    variant="secondary"
                    className={
                      report.status === 'submitted'
                        ? 'bg-green-100 text-green-700 border-green-200'
                        : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                    }
                  >
                    {report.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Начало смены</p>
                  <p className="font-mono">{report.shiftStart || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Конец смены</p>
                  <p className="font-mono">{report.shiftEnd || '-'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-slate-500">Последнее редактирование</p>
                  <p className="font-medium">{formatLastEditor(report)}</p>
                </div>
              </div>

              {report.piles?.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <HardHat className="w-4 h-4 text-orange-500" />
                      Забитые сваи ({report.piles.length})
                    </h4>
                    <div className="space-y-1">
                      {report.piles.map((pile) => (
                        <div
                          key={pile.id}
                          className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                        >
                          <span>{pile.pileGrade?.name || '-'}</span>
                          <span className="font-mono font-semibold">{pile.count} шт.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {report.drillings?.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Drill className="w-4 h-4 text-blue-500" />
                      Лидерное бурение ({report.drillings.length})
                    </h4>
                    <div className="space-y-1">
                      {report.drillings.map((drilling) => (
                        <div
                          key={drilling.id}
                          className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                        >
                          <span>{drilling.type?.name || '-'}</span>
                          <span className="text-right font-mono font-semibold">
                            <span className="block">{drilling.count || 1} шт.</span>
                            <span className="block text-xs text-slate-500">{drilling.meters} м.п.</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {report.downtimes?.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-500" />
                      Простой техники
                    </h4>
                    <div className="space-y-1">
                      {report.downtimes.map((downtime) => (
                        <div
                          key={downtime.id}
                          className="flex justify-between text-sm p-2 bg-slate-50 rounded"
                        >
                          <div>
                            <span>{downtime.reason?.name || '-'}</span>
                            {downtime.comment && (
                              <p className="text-3xs text-slate-500">{downtime.comment}</p>
                            )}
                          </div>
                          <span className="font-mono font-semibold text-amber-600">
                            {downtime.duration} ч
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
