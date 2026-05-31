'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  History,
  FileText,
  HardHat,
  Drill,
  Clock,
  Filter,
  Loader2,
  CalendarDays,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import type { ReportListItemDTO, ReportDTO } from '@/lib/types';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import { QueryErrorBanner } from '@/components/piling/async-ui';

export function ReportHistory() {
  const user = usePilingStore((s) => s.currentUser);
  const [reports, setReports] = useState<ReportListItemDTO[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [filterSiteId, setFilterSiteId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  // Set when loading reports fails, so a server/network error shows a real
  // error state instead of a silently-empty "Нет отчётов" (incident 2026-05-30).
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const [reportsRes, sitesRes] = await Promise.all([
        authFetch(`/api/reports/my?userId=${user.id}`),
        authFetch(`/api/sites?userId=${user.id}`),
      ]);

      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.data || data.reports || []);
      } else {
        // HTTP error does NOT throw — without this the list would render
        // empty as if the operator had no reports.
        setError('Не удалось загрузить отчёты. Сервер вернул ошибку.');
        toast.error('Ошибка загрузки отчётов');
      }

      if (sitesRes.ok) {
        const data = await sitesRes.json();
        setSites(data.data || data.sites || []);
      }
    } catch {
      setError('Не удалось загрузить отчёты. Проверьте соединение.');
      toast.error('Ошибка загрузки отчётов');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenDetail = useCallback(async (report: ReportListItemDTO) => {
    setSelectedReport(null);
    setDetailLoading(true);

    try {
      const res = await authFetch(
        `/api/reports/edit?userId=${user?.id}&siteId=${report.siteId}&date=${report.date}`
      );

      if (res.ok) {
        const data = await res.json();
        if (data.report) {
          setSelectedReport(data.report as ReportDTO);
        } else {
          toast.error('Детали отчёта не найдены');
        }
      }
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setDetailLoading(false);
    }
  }, [user]);

  const searchParams = useSearchParams();
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || loading) return;
    const reportId = searchParams.get('reportId');
    if (!reportId) return;
    const match = reports.find((r) => r.id === reportId);
    if (match) {
      autoOpenedRef.current = true;
      void handleOpenDetail(match);
    }
  }, [loading, reports, searchParams, handleOpenDetail]);

  const filteredReports =
    filterSiteId === 'all' ? reports : reports.filter((report) => report.siteId === filterSiteId);

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const formatLastEditor = (report: ReportDTO) => {
    if (!report.lastEditedByName) {
      return 'Нет данных';
    }

    const roleLabel =
      report.lastEditedByRole === 'ADMIN'
        ? 'Администратор'
        : report.lastEditedByRole === 'DISPATCHER'
          ? 'Диспетчер'
          : report.lastEditedByRole === 'ASSISTANT'
            ? 'Помощник'
            : 'Оператор';

    return `${roleLabel}: ${report.lastEditedByName}`;
  };

  const handleOpenPreview = async (report: ReportListItemDTO, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    try {
      const res = await authFetch(
        `/api/reports/edit?userId=${user?.id}&siteId=${report.siteId}&date=${report.date}`
      );

      if (!res.ok) {
        toast.error('Ошибка загрузки отчёта');
        return;
      }

      const data = await res.json();
      const reportId = data.report?.reportId;

      if (!reportId) {
        toast.error('reportId не найден');
        return;
      }

      setPreviewReportId(reportId);
    } catch {
      toast.error('Ошибка загрузки отчёта');
    }
  };

  const handlePreviewFromDetail = (reportId: string, reportDate: string) => {
    if (!reportId) return;
    setPreviewReportId(reportId);
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <History className="w-5 h-5 text-orange-500" />
          История отчётов
        </h1>
        <span className="text-xs text-slate-500 font-mono tabular-nums">
          {filteredReports.length} записей
        </span>
      </div>

      {sites.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <Select value={filterSiteId} onValueChange={setFilterSiteId}>
            <SelectTrigger className="w-full h-10">
              <SelectValue placeholder="Все объекты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все объекты</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error ? (
        <QueryErrorBanner
          title="Не удалось загрузить отчёты"
          message={error}
          onRetry={() => void loadData()}
        />
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Нет отчётов</p>
          <p className="text-xs text-slate-400 mt-1">Создайте первый отчёт в разделе «Новый отчёт»</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report, index) => (
            <motion.div
              key={report.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index < 20 ? index * 0.03 : 0 }}
            >
              <Card className="cursor-pointer card-hover" onClick={() => handleOpenDetail(report)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{report.siteName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500">
                        <CalendarDays className="w-3 h-3" />
                        {formatDate(report.date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => handleOpenPreview(report, e)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                        title="Предпросмотр PDF"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
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
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="flex items-center gap-1.5">
                      <HardHat className="w-3.5 h-3.5 text-orange-500" />
                      <span className="text-sm font-mono font-semibold text-slate-900">
                        {report.totalPiles}/{(report.totalPileMeters ?? 0).toFixed(1)}
                      </span>
                      <span className="text-3xs text-slate-500">шт/м.п.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Drill className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-sm font-mono font-semibold text-slate-900">
                        {report.totalDrillingCount ?? 0}/{(report.totalDrilling ?? 0).toFixed(1)}
                      </span>
                      <span className="text-3xs text-slate-500">шт/м</span>
                    </div>
                    {report.totalDowntime > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-sm font-mono font-semibold text-amber-600">
                          {report.totalDowntime}
                        </span>
                        <span className="text-3xs text-slate-500">ч</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedReport || detailLoading}
        onOpenChange={(open) => {
          if (!open) setSelectedReport(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar">
          <DialogTitle className="sr-only">
            {selectedReport ? `Отчёт от ${formatDate(selectedReport.date)}` : 'Загрузка отчёта'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {selectedReport ? `Детали отчёта за ${formatDate(selectedReport.date)}` : 'Загрузка данных отчёта'}
          </DialogDescription>

          {detailLoading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            </div>
          ) : selectedReport ? (
            <>
              <div className="flex items-center justify-between">
                <DialogHeader>
                  <div className="text-base font-semibold">Отчёт от {formatDate(selectedReport.date)}</div>
                </DialogHeader>
                <button
                  onClick={() => handlePreviewFromDetail(selectedReport.reportId!, selectedReport.date)}
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
                    <p className="font-medium">{selectedReport.site.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Статус</p>
                    <Badge
                      variant="secondary"
                      className={
                        selectedReport.status === 'submitted'
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      }
                    >
                      {selectedReport.status === 'submitted' ? 'Отправлен' : 'Черновик'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Начало смены</p>
                    <p className="font-mono">{selectedReport.shiftStart || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Конец смены</p>
                    <p className="font-mono">{selectedReport.shiftEnd || '-'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500">Последнее редактирование</p>
                    <p className="font-medium">{formatLastEditor(selectedReport)}</p>
                  </div>
                </div>

                {selectedReport.piles?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <HardHat className="w-4 h-4 text-orange-500" />
                        Забитые сваи ({selectedReport.piles.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.piles.map((pile) => (
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

                {selectedReport.drillings?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Drill className="w-4 h-4 text-blue-500" />
                        Лидерное бурение ({selectedReport.drillings.length})
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.drillings.map((drilling) => (
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

                {selectedReport.downtimes?.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Простой техники
                      </h4>
                      <div className="space-y-1">
                        {selectedReport.downtimes.map((downtime) => (
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

      {previewReportId && (
        <PdfPreviewDialog
          open={!!previewReportId}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewReportId(null);
            }
          }}
          reportId={previewReportId}
        />
      )}
    </div>
  );
}
