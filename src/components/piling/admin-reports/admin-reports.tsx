'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Filter } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { cn } from '@/lib/utils';
import { pluralizeRu } from '@/lib/format';
import type { ReportDTO } from '@/lib/types';
import { getReportTotals, addTotals } from './report-totals';
import { useReportsData } from './use-reports-data';
import { ReportFilters } from './report-filters';
import { ReportDetailDialog } from './report-detail-dialog';
import { ReportFormDialog } from './report-form-dialog';
import { useReportHistory } from './use-report-history';
import { todayYmd, shiftYmd } from './report-list-format';
import { EvidenceReportRow, EvidenceSummary, ReportsHeader } from './report-evidence-row';
import { ReportEvidencePreview } from './report-evidence-preview';

type QuickFilter = 'all' | 'today' | 'yesterday' | 'week' | 'downtime' | 'withPhotos' | 'edited';

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: '7 дней' },
  { key: 'downtime', label: 'С простоем' },
  { key: 'withPhotos', label: 'С фото' },
  { key: 'edited', label: 'Изменены админом' },
];

export function AdminReports() {
  const {
    reports, sites, operators, pileGrades, drillingTypes, downtimeReasons, equipment,
    filterSiteId, setFilterSiteId,
    filterUserId, setFilterUserId,
    periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, loading, loadingReferenceData, loadingMore, hasMore, error,
    handleApplyPeriod, handleResetPeriod, loadMoreReports, loadReports, loadReferenceData,
  } = useReportsData();

  const [detailReport, setDetailReport] = useState<ReportDTO | null>(null);
  const [previewReport, setPreviewReport] = useState<ReportDTO | null>(null);
  // Ширина правой панели — тянется за левый край (как в справочниках/установках).
  const [panelWidth, setPanelWidth] = useState(520);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editReport, setEditReport] = useState<ReportDTO | null>(null);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filterEquipmentId, setFilterEquipmentId] = useState('all');
  // The preview pane shows the user-selected report, falling back to the first
  // one when nothing is selected (so it's never empty while reports exist).
  const effectivePreview = previewReport ?? reports[0] ?? null;
  const reportHistory = useReportHistory(effectivePreview?.reportId);

  useEffect(() => {
    if (showCreateDialog) {
      void loadReferenceData();
    }
  }, [showCreateDialog, loadReferenceData]);

  const handleDelete = async (report: ReportDTO) => {
    if (!report.reportId) return;
    if (!window.confirm(`Удалить отчёт от ${formatDate(report.date)} (${report.user?.name || 'Неизвестный'})? Действие необратимо.`)) {
      return;
    }
    setDeletingId(report.reportId);
    try {
      const { authFetch } = await import('@/lib/api');
      const res = await authFetch('/api/reports/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.reportId }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Ошибка удаления (${res.status}): ${msg.slice(0, 200)}`);
      }
      if (effectivePreview?.reportId === report.reportId) setPreviewReport(null);
      await loadReports();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить отчёт');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreviewPdf = (report: ReportDTO) => {
    if (!report.reportId) return;
    setPreviewReportId(report.reportId);
  };

  const filteredReports = useMemo(() => {
    const today = todayYmd();
    const yesterday = shiftYmd(-1);
    const weekStart = shiftYmd(-6);
    return reports.filter((report) => {
      const totals = getReportTotals(report);
      if (quickFilter === 'today' && report.date !== today) return false;
      if (quickFilter === 'yesterday' && report.date !== yesterday) return false;
      if (quickFilter === 'week' && report.date < weekStart) return false;
      if (quickFilter === 'downtime' && totals.downtimeHours <= 0) return false;
      if (quickFilter === 'withPhotos' && report.hasPhotos !== true) return false;
      if (quickFilter === 'edited' && !report.lastEditedByName) return false;
      if (filterEquipmentId !== 'all' && report.equipment?.id !== filterEquipmentId) return false;
      return true;
    });
  }, [filterEquipmentId, quickFilter, reports]);

  const totals = useMemo(() => addTotals(filteredReports), [filteredReports]);
  const photoCount = useMemo(
    () => filteredReports.filter((r) => r.hasPhotos === true).length,
    [filteredReports],
  );
  const reportWord = `${filteredReports.length} ${pluralizeRu(filteredReports.length, ['отчёт', 'отчёта', 'отчётов'])}`;

  const startResize = (event: React.MouseEvent) => {
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
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatLastEditor = (report: ReportDTO) => {
    if (!report.lastEditedByName) return report.user?.name ? `Автор: ${report.user.name}` : 'Нет данных';
    const roleLabel = report.lastEditedByRole === 'ADMIN' ? 'Администратор'
      : report.lastEditedByRole === 'DISPATCHER' ? 'Диспетчер'
      : report.lastEditedByRole === 'ASSISTANT' ? 'Помощник' : 'Оператор';
    // The admin account is literally named «Администратор» — avoid «Администратор: Администратор».
    if (report.lastEditedByName === roleLabel) return roleLabel;
    return `${roleLabel}: ${report.lastEditedByName}`;
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50/60 p-4 lg:p-6">
      {error ? (
        <div className="space-y-4">
          <ReportsHeader
            reportWord={reportWord}
            onPrint={() => window.print()}
            onCreate={() => { setEditReport(null); setShowCreateDialog(true); }}
          />
          <QueryErrorBanner
            title="Не удалось загрузить отчёты"
            message={error}
            onRetry={loadReports}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Заголовок и KPI — во всю ширину, над колонками: внутри левой
              колонки плитки в один ряд ужимались и текст обрезался. */}
          <ReportsHeader
            reportWord={reportWord}
            onPrint={() => window.print()}
            onCreate={() => { setEditReport(null); setShowCreateDialog(true); }}
          />

          <EvidenceSummary reportCount={filteredReports.length} totals={totals} photoCount={photoCount} />

          <div
            style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}
            className="grid gap-4 xl:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]"
          >
          <div className="min-w-0 space-y-4">

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="hidden h-4 w-4 text-slate-400 sm:block" />
                {QUICK_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setQuickFilter(filter.key)}
                    className={cn(
                      'min-h-9 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      quickFilter === filter.key
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(event) => setPeriodFrom(event.target.value)}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-mono text-slate-700 outline-none focus:border-slate-400"
                  />
                  <span className="text-xs text-slate-400">-</span>
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(event) => setPeriodTo(event.target.value)}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-mono text-slate-700 outline-none focus:border-slate-400"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={periodActive ? handleResetPeriod : handleApplyPeriod}
                    className="h-9 border-slate-200 bg-white px-3 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {periodActive ? 'Сбросить' : 'Применить'}
                  </Button>
                </div>
              </div>

              <ReportFilters
                sites={sites} filterSiteId={filterSiteId} onFilterSiteChange={setFilterSiteId}
                equipment={equipment} filterEquipmentId={filterEquipmentId} onFilterEquipmentChange={setFilterEquipmentId}
                operators={operators} filterUserId={filterUserId} onFilterUserChange={setFilterUserId}
              />

              <div className="text-xs text-slate-500">
                Загружено {reports.length}{hasMore ? '+ ' : ' '}· показано {filteredReports.length}
              </div>
            </div>

            <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="hidden border-b border-slate-200 bg-slate-100/80 px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:grid-cols-[116px_minmax(170px,1.2fr)_minmax(150px,1fr)_86px_92px_86px_112px]">
                <span>Дата</span>
                <span>Объект / установка</span>
                <span>Оператор</span>
                <span className="text-right">Сваи</span>
                <span className="text-right">Бурение</span>
                <span className="text-right">Простой</span>
                <span className="text-right">Действия</span>
              </div>

              {filteredReports.length === 0 ? (
                <div className="grid place-items-center px-4 py-16 text-center">
                  <FileText className="mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">Отчёты не найдены</p>
                  <p className="mt-1 max-w-sm text-xs text-slate-400">
                    Попробуйте изменить быстрые фильтры, период, объект, установку или оператора.
                  </p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {filteredReports.map((report) => (
                      <EvidenceReportRow
                        key={report.id}
                        report={report}
                        active={effectivePreview?.reportId === report.reportId}
                        deleting={deletingId === report.reportId}
                        formatLastEditor={formatLastEditor}
                        onSelect={setPreviewReport}
                        onOpenDetails={setDetailReport}
                        onEdit={(r) => { setEditReport(r); setShowCreateDialog(true); }}
                        onPreviewPdf={handlePreviewPdf}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                  {hasMore && (
                    <div className="border-t border-slate-200 bg-slate-50/80 p-3 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadMoreReports()}
                        disabled={loadingMore}
                        className="border-slate-300 bg-white"
                      >
                        {loadingMore ? 'Загрузка...' : 'Загрузить ещё отчёты'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          <div className="relative min-w-0">
            {/* Потяните за левый край, чтобы изменить ширину панели. */}
            <div
              onMouseDown={startResize}
              title="Потяните, чтобы изменить ширину"
              className="absolute -left-2.5 top-0 z-10 hidden h-full w-2.5 cursor-col-resize xl:block"
            >
              <div className="mx-auto h-full w-px bg-slate-200 transition-colors hover:bg-blue-400" />
            </div>
            <ReportEvidencePreview
              report={effectivePreview}
              history={reportHistory}
              formatDate={formatDate}
              onClose={() => setPreviewReport(null)}
              onEdit={(r) => { setEditReport(r); setShowCreateDialog(true); }}
              onPreviewPdf={handlePreviewPdf}
              onPrint={() => window.print()}
            />
          </div>
          </div>
        </div>
      )}

      <ReportDetailDialog
        report={detailReport}
        onClose={() => setDetailReport(null)}
        onPreviewPdf={handlePreviewPdf}
        formatDate={formatDate}
        formatLastEditor={formatLastEditor}
      />

      <PdfPreviewDialog open={!!previewReportId} onOpenChange={(open) => { if (!open) setPreviewReportId(null); }}
        reportId={previewReportId} />

      <ReportFormDialog key={editReport?.reportId || 'new'}
        open={showCreateDialog} onClose={() => { setShowCreateDialog(false); setEditReport(null); }}
        editReport={editReport}
        loadingReferenceData={loadingReferenceData}
        operators={operators} sites={sites} pileGrades={pileGrades}
        drillingTypes={drillingTypes} downtimeReasons={downtimeReasons} equipment={equipment}
        onSuccess={loadReports} />
    </div>
  );
}
