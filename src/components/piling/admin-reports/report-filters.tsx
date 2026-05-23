'use client';

import { CalendarDays, Filter, RotateCcw, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SiteFlatDTO } from '@/lib/types';
import { formatNumber } from '@/lib/format';

interface OperatorOption {
  id: string;
  name: string;
}

interface ReportFiltersProps {
  sites: SiteFlatDTO[];
  filterSiteId: string;
  onFilterSiteChange: (v: string) => void;
  operators: OperatorOption[];
  filterUserId: string;
  onFilterUserChange: (v: string) => void;
  periodFrom: string;
  onPeriodFromChange: (v: string) => void;
  periodTo: string;
  onPeriodToChange: (v: string) => void;
  periodActive: boolean;
  periodSummary: { totalPiles: number; totalPileMeters?: number; totalDrillingCount?: number; totalDrilling: number; totalDowntime: number; reportCount: number } | null;
  onApplyPeriod: () => void;
  onResetPeriod: () => void;
  onExportPdf: () => void;
  generatingPdf: boolean;
}

export function ReportFilters({
  sites, filterSiteId, onFilterSiteChange,
  operators, filterUserId, onFilterUserChange,
  periodFrom, onPeriodFromChange, periodTo, onPeriodToChange,
  periodActive, periodSummary, onApplyPeriod, onResetPeriod,
  onExportPdf, generatingPdf,
}: ReportFiltersProps) {
  if (sites.length === 0 && operators.length === 0 && !periodActive) return null;

  return (
    <div className="space-y-3">
      {(sites.length > 0 || operators.length > 0) && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0 hidden sm:block" />
          {sites.length > 0 && (
            <Select value={filterSiteId} onValueChange={onFilterSiteChange}>
              <SelectTrigger className="w-full sm:max-w-xs h-10">
                <SelectValue placeholder="Все объекты" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все объекты</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {operators.length > 0 && (
            <Select value={filterUserId} onValueChange={onFilterUserChange}>
              <SelectTrigger className="w-full sm:max-w-xs h-10">
                <SelectValue placeholder="Все операторы" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все операторы</SelectItem>
                {operators.map((op) => (
                  <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
            <CalendarDays className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Период:</span>
            <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
              <Input type="date" value={periodFrom} onChange={(e) => onPeriodFromChange(e.target.value)}
                className="h-9 text-sm font-mono flex-1 sm:flex-none sm:w-40" />
              <span className="text-slate-400 text-xs">—</span>
              <Input type="date" value={periodTo} onChange={(e) => onPeriodToChange(e.target.value)}
                className="h-9 text-sm font-mono flex-1 sm:flex-none sm:w-40" />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {!periodActive ? (
                <Button onClick={onApplyPeriod} size="sm" className="h-9 bg-slate-800 hover:bg-slate-900 text-white text-xs">
                  Применить
                </Button>
              ) : (
                <Button onClick={onResetPeriod} variant="outline" size="sm" className="h-9 text-xs">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />Сбросить
                </Button>
              )}
              {periodActive && (
                <Button onClick={onExportPdf} size="sm" variant="outline"
                  className="h-9 text-xs border-red-200 text-red-600 hover:bg-red-50" disabled={generatingPdf}>
                  {generatingPdf ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
                  Печать PDF
                </Button>
              )}
            </div>
          </div>

          {periodActive && periodSummary && (
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs bg-orange-50 text-orange-700 px-2.5 py-1 rounded-full font-mono">
                {periodSummary.totalPiles} шт. / {formatNumber(periodSummary.totalPileMeters ?? 0)} м.п.
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-mono">
                {periodSummary.totalDrillingCount ?? 0} шт. / {formatNumber(periodSummary.totalDrilling)} м
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full font-mono">
                {formatNumber(periodSummary.totalDowntime)} ч
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-mono">
                {periodSummary.reportCount} отч.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
