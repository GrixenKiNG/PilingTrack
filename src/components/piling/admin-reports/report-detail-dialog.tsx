'use client';

import { HardHat, Drill, Clock, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import type { ReportDTO } from '@/lib/types';
import { pluralizeRu } from '@/lib/format';

interface ReportDetailDialogProps {
  report: ReportDTO | null;
  onClose: () => void;
  onPreviewPdf: (r: ReportDTO) => void;
  formatDate: (d: string) => string;
  formatLastEditor: (r: ReportDTO) => string;
}

function formatRecordCount(count: number) {
  return `${count} ${pluralizeRu(count, ['запись', 'записи', 'записей'])}`;
}

export function ReportDetailDialog({
  report, onClose, onPreviewPdf, formatDate, formatLastEditor,
}: ReportDetailDialogProps) {
  if (!report) return null;

  return (
    <>
      <Dialog open={!!report} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <DialogHeader>
              <DialogTitle className="text-base">Отчёт от {formatDate(report.date)}</DialogTitle>
            </DialogHeader>
            <button onClick={() => onPreviewPdf(report)}
              className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors">
              <Eye className="w-3.5 h-3.5" />Предпросмотр PDF
            </button>
          </div>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-slate-500">Оператор</p><p className="font-medium">{report.user?.name || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Объект</p><p className="font-medium">{report.site?.name || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Смена</p><p className="font-mono">{report.shiftStart || '—'} – {report.shiftEnd || '—'}</p></div>
              <div>
                <p className="text-xs text-slate-500">Установка</p>
                <p className="font-medium">{report.equipment?.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Статус</p>
                <Badge variant="secondary" className={
                  report.status === 'submitted' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                }>{report.status === 'submitted' ? 'Отправлен' : 'Черновик'}</Badge>
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
                    Забитые сваи ({formatRecordCount(report.piles.length)})
                  </h4>
                  <div className="space-y-1">
                    {report.piles.map((p) => (
                      <div key={p.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded">
                        <span>{p.pileGrade?.name || '—'}</span>
                        <span className="font-mono font-semibold">{p.count} шт.</span>
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
                    Лидерное бурение ({formatRecordCount(report.drillings.length)})
                  </h4>
                  <div className="space-y-1">
                    {report.drillings.map((d) => (
                      <div key={d.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded">
                        <span>{d.type?.name || '—'}</span>
                        <span className="font-mono font-semibold">{d.meters} м</span>
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
                    <Clock className="w-4 h-4 text-amber-500" />Простой техники
                  </h4>
                  <div className="space-y-1">
                    {report.downtimes.map((dt) => (
                      <div key={dt.id} className="flex justify-between text-sm p-2 bg-slate-50 rounded">
                        <div>
                          <span>{dt.reason?.name || '—'}</span>
                          {dt.comment && <p className="text-[10px] text-slate-500">{dt.comment}</p>}
                        </div>
                        <span className="font-mono font-semibold text-amber-600">{dt.duration} ч</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
