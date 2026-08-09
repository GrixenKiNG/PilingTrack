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
} from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ReportListItemDTO, ReportDTO } from '@/lib/types';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { ReportHistoryDetailDialog } from './report-history-detail-dialog';

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
  // Cursor pagination: /api/reports/my returns 50 at a time + a nextCursor.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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
        setNextCursor(data.nextCursor ?? null);
      } else {
        // HTTP error does NOT throw — without this the list would render
        // empty as if the operator had no reports.
        setError('Сервис отчётов временно недоступен. Повторите попытку.');
        toast.error('История отчётов не загрузилась');
      }

      if (sitesRes.ok) {
        const data = await sitesRes.json();
        setSites(data.data || data.sites || []);
      }
    } catch {
      setError('Проверьте подключение к интернету и повторите попытку.');
      toast.error('История отчётов не загрузилась');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void loadData();
  }, [loadData]);

  const loadMore = useCallback(async () => {
    if (!user || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await authFetch(`/api/reports/my?userId=${user.id}&cursor=${encodeURIComponent(nextCursor)}`);
      if (res.ok) {
        const data = await res.json();
        const more: ReportListItemDTO[] = data.data || data.reports || [];
        setReports((prev) => [...prev, ...more]);
        setNextCursor(data.nextCursor ?? null);
      } else {
        toast.error('Следующая часть истории не загрузилась. Повторите попытку.');
      }
    } catch {
      toast.error('Следующая часть истории не загрузилась. Проверьте подключение.');
    } finally {
      setLoadingMore(false);
    }
  }, [user, nextCursor, loadingMore]);

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
          toast.error('Отчёт больше недоступен. Обновите список и попробуйте снова.');
        }
      } else {
        toast.error('Не удалось открыть отчёт. Повторите попытку.');
      }
    } catch {
      toast.error('Не удалось открыть отчёт. Проверьте подключение.');
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
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
        toast.error('Не удалось подготовить PDF. Повторите попытку.');
        return;
      }

      const data = await res.json();
      const reportId = data.report?.reportId;

      if (!reportId) {
        toast.error('PDF для этого отчёта пока недоступен.');
        return;
      }

      setPreviewReportId(reportId);
    } catch {
      toast.error('Не удалось подготовить PDF. Проверьте подключение.');
    }
  };

  const handlePreviewFromDetail = (reportId: string, _reportDate: string) => {
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
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <History className="w-5 h-5 text-signal-strong" />
          История отчётов
        </h1>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          Отчётов: {filteredReports.length}
        </span>
      </div>

      {sites.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
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
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">
            {filterSiteId === 'all' ? 'Отчётов пока нет' : 'На выбранном объекте отчётов нет'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {filterSiteId === 'all'
              ? 'После сдачи смены отчёт появится в этом списке.'
              : 'Выберите другой объект или покажите отчёты по всем объектам.'}
          </p>
          {filterSiteId !== 'all' && (
            <button
              type="button"
              onClick={() => setFilterSiteId('all')}
              className="mt-4 text-sm font-medium text-signal-strong hover:text-signal-strong"
            >
              Показать все отчёты
            </button>
          )}
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
                      <p className="text-sm font-medium text-foreground">{report.siteName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                        <CalendarDays className="w-3 h-3" />
                        {formatDate(report.date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => handleOpenPreview(report, e)}
                        className="flex h-11 w-11 items-center justify-center rounded-lg text-signal-strong transition-colors hover:bg-signal/10 hover:text-signal-strong"
                        title="Предпросмотр PDF"
                        aria-label={`Открыть PDF отчёта по объекту ${report.siteName} за ${formatDate(report.date)}`}
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
                      <HardHat className="w-3.5 h-3.5 text-signal-strong" />
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {report.totalPiles}/{(report.totalPileMeters ?? 0).toFixed(1)}
                      </span>
                      <span className="text-xs text-muted-foreground">шт/м.п.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Drill className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {report.totalDrillingCount ?? 0}/{(report.totalDrilling ?? 0).toFixed(1)}
                      </span>
                      <span className="text-xs text-muted-foreground">шт/м</span>
                    </div>
                    {report.totalDowntime > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-sm font-mono font-semibold text-amber-600">
                          {report.totalDowntime}
                        </span>
                        <span className="text-xs text-muted-foreground">ч</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}

          {nextCursor && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full h-11 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}

      <ReportHistoryDetailDialog
        report={selectedReport}
        loading={detailLoading}
        onClose={() => setSelectedReport(null)}
        onPreviewPdf={(reportId) => handlePreviewFromDetail(reportId, selectedReport?.date ?? '')}
        formatDate={formatDate}
        formatLastEditor={formatLastEditor}
      />

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
