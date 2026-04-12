'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ReportWithDetails } from './types';

interface ReportListProps {
  reports: ReportWithDetails[];
  loading: boolean;
  onViewPdf: (reportId: string) => void;
}

export function ReportList({ reports, loading, onViewPdf }: ReportListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="w-12 h-12 text-slate-300 mb-3" />
        <p className="text-sm text-slate-500">Отчёты не найдены</p>
        <p className="text-xs text-slate-400">Попробуйте изменить фильтры</p>
      </div>
    );
  }

  const shouldAnimate = reports.length < 50;

  return (
    <div className="space-y-2">
      {reports.map((report, index) => (
        <motion.div
          key={report.id}
          initial={shouldAnimate ? { opacity: 0, y: 8 } : undefined}
          animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
          transition={shouldAnimate ? { delay: index * 0.02 } : undefined}
          className="bg-white rounded-lg border hover:border-slate-300 transition-colors"
        >
          {/* Header row */}
          <div
            className="flex items-center gap-3 p-3 cursor-pointer"
            onClick={() => setExpandedId(expandedId === report.id ? null : report.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedId(expandedId === report.id ? null : report.id); }}
            aria-expanded={expandedId === report.id}
            aria-label={`Отчёт ${report.reportId} от ${report.date}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold truncate">{report.date}</span>
                <Badge variant={report.status === 'submitted' ? 'default' : 'secondary'} className="text-xs">
                  {report.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                </Badge>
                {report.shiftType === 'NIGHT' && (
                  <Badge variant="outline" className="text-xs">Ночная</Badge>
                )}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {report.siteName} · {report.operatorName}
                {report.equipmentName && ` · ${report.equipmentName}`}
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono text-slate-600 flex-shrink-0">
              <span>{report.piles.reduce((s, p) => s + p.count, 0)} свай</span>
              <span>{report.drillings.reduce((s, d) => s + d.meters, 0).toFixed(1)} м.п.</span>
              <span>{report.downtimes.reduce((s, d) => s + d.duration, 0)} мин</span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="min-w-[40px] min-h-[40px]"
                onClick={(e) => { e.stopPropagation(); onViewPdf(report.id); }}
                aria-label="Просмотреть PDF"
              >
                <Eye className="w-4 h-4" />
              </Button>
              {expandedId === report.id ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </div>
          </div>

          {/* Expanded details */}
          {expandedId === report.id && (
            <div className="px-3 pb-3 border-t bg-slate-50 rounded-b-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 text-xs">
                {/* Piles */}
                <div>
                  <div className="font-semibold text-orange-700 mb-1">Забитые сваи</div>
                  {report.piles.length > 0 ? (
                    <ul className="space-y-0.5">
                      {report.piles.map((pile, i) => (
                        <li key={i} className="text-slate-700">
                          {pile.pileGradeName}: {pile.count} шт.
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400">Нет данных</div>
                  )}
                </div>

                {/* Drillings */}
                <div>
                  <div className="font-semibold text-cyan-700 mb-1">Бурение</div>
                  {report.drillings.length > 0 ? (
                    <ul className="space-y-0.5">
                      {report.drillings.map((d, i) => (
                        <li key={i} className="text-slate-700">
                          {d.typeName}: {d.count} × {d.meters} м
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400">Нет данных</div>
                  )}
                </div>

                {/* Downtimes */}
                <div>
                  <div className="font-semibold text-amber-700 mb-1">Простои</div>
                  {report.downtimes.length > 0 ? (
                    <ul className="space-y-0.5">
                      {report.downtimes.map((dt, i) => (
                        <li key={i} className="text-slate-700">
                          {dt.reasonName}: {dt.duration} мин
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400">Нет простоев</div>
                  )}
                </div>
              </div>

              {report.lastEditedByName && (
                <div className="mt-2 pt-2 border-t text-xs text-slate-500">
                  Последнее изменение: {report.lastEditedByName}
                </div>
              )}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}
