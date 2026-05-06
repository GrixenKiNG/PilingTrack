'use client';

import { motion } from 'framer-motion';
import { FileText, HardHat, Drill, Clock, CalendarDays, User, Eye, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ReportDTO } from '@/lib/types';

interface ReportListItemProps {
  report: ReportDTO;
  index: number;
  pileGradeNames: Record<string, string>;
  drillTypeNames: Record<string, string>;
  dtReasonNames: Record<string, string>;
  formatDate: (d: string) => string;
  formatLastEditor: (r: ReportDTO) => string;
  onView: (r: ReportDTO) => void;
  onEdit: (r: ReportDTO) => void;
  onPreviewPdf: (r: ReportDTO) => void;
  onDelete: (r: ReportDTO) => void;
  deleting?: boolean;
}

function getPileLengthMeters(pileGradeName: string) {
  const match = pileGradeName.match(/\d{3}/);
  return match ? Number(match[0]) / 10 : 0;
}

export function ReportListItem({
  report, index, pileGradeNames, drillTypeNames, dtReasonNames,
  formatDate, formatLastEditor, onView, onEdit, onPreviewPdf, onDelete, deleting,
}: ReportListItemProps) {
  const totalPiles = report.piles?.reduce((s, p) => s + p.count, 0) || 0;
  const totalPileMeters = report.piles?.reduce((s, p) => s + getPileLengthMeters(p.pileGrade?.name || '') * p.count, 0) || 0;
  const totalDrillingCount = report.drillings?.reduce((s, d) => s + (d.count || 1), 0) || 0;
  const totalDrilling = report.drillings?.reduce((s, d) => s + d.meters, 0) || 0;
  const totalDowntime = report.downtimes?.reduce((s, d) => s + d.duration, 0) || 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index < 20 ? index * 0.02 : 0 }}>
      <Card className="card-hover">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onView(report)}>
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <p className="text-sm font-medium text-slate-900 truncate">
                  {report.user?.name || 'Неизвестный'}
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-500 truncate">Изменил: {formatLastEditor(report)}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" />{formatDate(report.date)}
                </span>
                <span>{report.site?.name}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className={
                report.status === 'submitted'
                  ? 'bg-green-100 text-green-700 border-green-200'
                  : 'bg-yellow-100 text-yellow-700 border-yellow-200'
              }>
                {report.status === 'submitted' ? 'Отправлен' : 'Черновик'}
              </Badge>
              <button onClick={(e) => { e.stopPropagation(); onPreviewPdf(report); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                title="Предпросмотр PDF">
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onEdit(report); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition-colors"
                title="Редактировать">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(report); }}
                disabled={deleting}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                title="Удалить">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1 text-xs">
              <HardHat className="w-3 h-3 text-orange-500" />
              <span className="font-mono font-semibold">{totalPiles}/{totalPileMeters.toFixed(1)}</span>
              <span className="text-slate-500">шт/м.п.</span>
            </span>
            <span className="flex items-center gap-1 text-xs">
              <Drill className="w-3 h-3 text-blue-500" />
              <span className="font-mono font-semibold">{totalDrillingCount}/{totalDrilling}</span>
              <span className="text-slate-500">шт/м</span>
            </span>
            {totalDowntime > 0 && (
              <span className="flex items-center gap-1 text-xs">
                <Clock className="w-3 h-3 text-amber-500" />
                <span className="font-mono font-semibold text-amber-600">{totalDowntime}</span>
                <span className="text-slate-500">ч</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
