'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Drill,
  Eye,
  FileDown,
  FileText,
  Filter,
  HardHat,
  History,
  Image as ImageIcon,
  Pencil,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { PhotoSection } from '@/components/piling/report-form/photo-section';
import { cn } from '@/lib/utils';
import { formatNumber, pluralizeRu } from '@/lib/format';
import type { ReportDTO } from '@/lib/types';
import { useReportsData } from './use-reports-data';
import { ReportFilters } from './report-filters';
import { ReportDetailDialog } from './report-detail-dialog';
import { ReportFormDialog } from './report-form-dialog';
import { ReportThumbnail } from './report-thumbnail';
import { useReportHistory } from './use-report-history';
import { statusLabel, type ReportHistory } from '@/services/reports/report-history';

type QuickFilter = 'all' | 'today' | 'yesterday' | 'week' | 'downtime' | 'withPhotos' | 'edited';

interface ReportTotals {
  piles: number;
  pileMeters: number;
  drillingCount: number;
  drillingMeters: number;
  downtimeHours: number;
  photoCount: number;
}

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: '7 дней' },
  { key: 'downtime', label: 'С простоем' },
  { key: 'withPhotos', label: 'С фото' },
  { key: 'edited', label: 'Изменены админом' },
];

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getPileLengthMeters(pileGradeName: string) {
  const match = pileGradeName.match(/\d{3}/);
  return match ? Number(match[0]) / 10 : 0;
}

function getReportTotals(report: ReportDTO): ReportTotals {
  const piles = report.piles?.reduce((sum, pile) => sum + pile.count, 0) || 0;
  const pileMeters = report.piles?.reduce(
    (sum, pile) => sum + getPileLengthMeters(pile.pileGrade?.name || '') * pile.count,
    0,
  ) || 0;
  const drillingCount = report.drillings?.reduce((sum, drilling) => sum + (drilling.count || 1), 0) || 0;
  const drillingMeters = report.drillings?.reduce((sum, drilling) => sum + drilling.meters, 0) || 0;
  const downtimeHours = report.downtimes?.reduce((sum, downtime) => sum + downtime.duration, 0) || 0;

  return { piles, pileMeters, drillingCount, drillingMeters, downtimeHours, photoCount: 0 };
}

function addTotals(reports: ReportDTO[]): ReportTotals {
  return reports.reduce<ReportTotals>((acc, report) => {
    const totals = getReportTotals(report);
    acc.piles += totals.piles;
    acc.pileMeters += totals.pileMeters;
    acc.drillingCount += totals.drillingCount;
    acc.drillingMeters += totals.drillingMeters;
    acc.downtimeHours += totals.downtimeHours;
    acc.photoCount += totals.photoCount;
    return acc;
  }, { piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, photoCount: 0 });
}

function formatHours(hours: number): string {
  if (!hours || hours <= 0) return '0 ч';
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  if (mins === 0) return `${whole} ч`;
  if (whole === 0) return `${mins} мин`;
  return `${whole} ч ${mins} мин`;
}

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}`;
}

function shiftLabel(report: ReportDTO): string {
  if (!report.shiftStart && !report.shiftEnd) return 'Смена не указана';
  return `${report.shiftStart || '--:--'} - ${report.shiftEnd || '--:--'}`;
}

function formatIsoDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Администратор';
  if (role === 'DISPATCHER') return 'Диспетчер';
  if (role === 'ASSISTANT') return 'Помощник';
  return 'Оператор';
}

function shiftDurationHours(report: ReportDTO): number | null {
  if (!report.shiftStart || !report.shiftEnd) return null;
  const [startHour, startMinute] = report.shiftStart.split(':').map(Number);
  const [endHour, endMinute] = report.shiftEnd.split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return (end - start) / 60;
}

function formatPercentValue(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function AdminReports() {
  const {
    reports, sites, operators, pileGrades, drillingTypes, downtimeReasons, equipment,
    filterSiteId, setFilterSiteId,
    filterUserId, setFilterUserId,
    periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, periodSummary, loading, loadingSites, loadingReferenceData, loadingMore, hasMore, error,
    handleApplyPeriod, handleResetPeriod, loadMoreReports, loadReports, loadReferenceData,
  } = useReportsData();

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [detailReport, setDetailReport] = useState<ReportDTO | null>(null);
  const [previewReport, setPreviewReport] = useState<ReportDTO | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editReport, setEditReport] = useState<ReportDTO | null>(null);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filterEquipmentId, setFilterEquipmentId] = useState('all');
  const [photoReportIds, setPhotoReportIds] = useState<Record<string, boolean>>({});
  const reportHistory = useReportHistory(previewReport?.reportId);

  useEffect(() => {
    if (showCreateDialog) {
      void loadReferenceData();
    }
  }, [showCreateDialog, loadReferenceData]);

  useEffect(() => {
    if (!previewReport && reports.length > 0) {
      setPreviewReport(reports[0]);
    }
  }, [previewReport, reports]);

  useEffect(() => {
    const missing = reports
      .map((report) => report.reportId)
      .filter((reportId) => photoReportIds[reportId] === undefined)
      .slice(0, 100);
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      const { authFetch } = await import('@/lib/api');
      const entries = await Promise.all(missing.map(async (reportId) => {
        try {
          const res = await authFetch(`/api/media?entityType=report&entityId=${encodeURIComponent(reportId)}`);
          if (!res.ok) return [reportId, false] as const;
          const json = await res.json();
          return [reportId, Array.isArray(json.data) && json.data.length > 0] as const;
        } catch {
          return [reportId, false] as const;
        }
      }));
      if (!cancelled) {
        setPhotoReportIds((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [photoReportIds, reports]);

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
      if (previewReport?.reportId === report.reportId) setPreviewReport(null);
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

  const handleExportPdf = async () => {
    if (!periodFrom || !periodTo) return;
    setGeneratingPdf(true);
    try {
      const { authFetch } = await import('@/lib/api');
      const params = new URLSearchParams({ dateFrom: periodFrom, dateTo: periodTo, inline: '1' });
      if (filterSiteId !== 'all') params.set('siteId', filterSiteId);
      if (filterUserId !== 'all') params.set('userId', filterUserId);
      const res = await authFetch(`/api/reports/pdf?${params}`);
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Ошибка генерации PDF (${res.status}): ${msg.slice(0, 200)}`);
      }
      const blob = await res.blob();
      if (blob.size === 0 || blob.type.indexOf('pdf') === -1) {
        throw new Error('Сервер вернул пустой или неверный PDF');
      }
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        alert('Разрешите всплывающие окна, чтобы открыть PDF для печати.');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось сформировать PDF');
    } finally {
      setGeneratingPdf(false);
    }
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
      if (quickFilter === 'withPhotos' && photoReportIds[report.reportId] !== true) return false;
      if (quickFilter === 'edited' && !report.lastEditedByName) return false;
      if (filterEquipmentId !== 'all' && report.equipment?.id !== filterEquipmentId) return false;
      return true;
    });
  }, [filterEquipmentId, photoReportIds, quickFilter, reports]);

  const totals = useMemo(() => addTotals(filteredReports), [filteredReports]);
  const photoCount = useMemo(
    () => filteredReports.filter((r) => photoReportIds[r.reportId] === true).length,
    [filteredReports, photoReportIds],
  );
  const reportWord = `${filteredReports.length} ${pluralizeRu(filteredReports.length, ['отчёт', 'отчёта', 'отчётов'])}`;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatLastEditor = (report: ReportDTO) => {
    if (!report.lastEditedByName) return report.user?.name ? `Автор: ${report.user.name}` : 'Нет данных';
    const roleLabel = report.lastEditedByRole === 'ADMIN' ? 'Администратор'
      : report.lastEditedByRole === 'DISPATCHER' ? 'Диспетчер'
      : report.lastEditedByRole === 'ASSISTANT' ? 'Помощник' : 'Оператор';
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
          <div className="min-w-0 space-y-4">
            <ReportsHeader
              reportWord={reportWord}
              onPrint={() => window.print()}
              onCreate={() => { setEditReport(null); setShowCreateDialog(true); }}
            />

            <EvidenceSummary reportCount={filteredReports.length} totals={totals} photoCount={photoCount} />

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
                        active={previewReport?.reportId === report.reportId}
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

          <ReportEvidencePreview
            report={previewReport}
            history={reportHistory}
            formatDate={formatDate}
            onClose={() => setPreviewReport(null)}
            onEdit={(r) => { setEditReport(r); setShowCreateDialog(true); }}
            onPreviewPdf={handlePreviewPdf}
            onPrint={() => window.print()}
          />
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

function ReportsHeader({
  reportWord,
  onPrint,
  onCreate,
}: {
  reportWord: string;
  onPrint: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950">
            <FileText className="h-5 w-5 text-orange-500" />
            Отчёты
          </h1>
          <Badge variant="outline" className="border-slate-300 bg-white font-mono text-3xs text-slate-500">
            {reportWord}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">Журнал смен, работ, простоев и подтверждений</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Button
          onClick={onPrint}
          variant="outline"
          className="h-10 border-slate-300 bg-white text-slate-700"
        >
          <Printer className="mr-1.5 h-4 w-4" />
          Печать
        </Button>
        <Button
          onClick={onCreate}
          className="h-10 bg-orange-500 text-white hover:bg-orange-600"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Новый отчёт
        </Button>
      </div>
    </div>
  );
}

function EvidenceSummary({ reportCount, totals, photoCount }: { reportCount: number; totals: ReportTotals; photoCount: number }) {
  const items = [
    { label: 'Отчёты', value: String(reportCount), icon: FileText, detail: 'за выбранный срез', tone: 'slate' },
    { label: 'Сваи', value: formatNumber(totals.piles), icon: HardHat, detail: `${formatNumber(totals.pileMeters)} м.п.`, tone: 'orange' },
    { label: 'Бурение', value: formatNumber(totals.drillingCount), icon: Drill, detail: `${formatNumber(totals.drillingMeters)} м`, tone: 'blue' },
    { label: 'Простой', value: formatHours(totals.downtimeHours), icon: Clock, detail: 'суммарно', tone: 'amber' },
    { label: 'Фото', value: String(photoCount), icon: ImageIcon, detail: 'отчётов с фото', tone: 'emerald' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">{item.label}</span>
            <item.icon className={cn(
              'h-4 w-4',
              item.tone === 'orange' && 'text-orange-500',
              item.tone === 'blue' && 'text-blue-500',
              item.tone === 'amber' && 'text-amber-500',
              item.tone === 'emerald' && 'text-emerald-500',
              item.tone === 'slate' && 'text-slate-400',
            )} />
          </div>
          <p className="font-mono text-xl font-bold tabular-nums text-slate-950">{item.value}</p>
          <p className="mt-0.5 text-3xs text-slate-400">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function EvidenceReportRow({
  report,
  active,
  deleting,
  formatLastEditor,
  onSelect,
  onOpenDetails,
  onEdit,
  onPreviewPdf,
  onDelete,
}: {
  report: ReportDTO;
  active: boolean;
  deleting?: boolean;
  formatLastEditor: (r: ReportDTO) => string;
  onSelect: (r: ReportDTO) => void;
  onOpenDetails: (r: ReportDTO) => void;
  onEdit: (r: ReportDTO) => void;
  onPreviewPdf: (r: ReportDTO) => void;
  onDelete: (r: ReportDTO) => void;
}) {
  const totals = getReportTotals(report);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(report)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(report);
      }}
      className={cn(
        'grid cursor-pointer gap-3 px-3 py-3 text-sm outline-none transition-colors hover:bg-orange-50/30 lg:grid-cols-[116px_minmax(170px,1.2fr)_minmax(150px,1fr)_86px_92px_86px_112px] lg:items-center',
        active && 'bg-orange-50/70 ring-1 ring-inset ring-orange-200',
      )}
    >
      <div className="flex items-center justify-between gap-3 lg:block">
        <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">{shortDate(report.date)}</div>
        <div className="mt-0.5 text-2xs text-slate-400">{shiftLabel(report)}</div>
      </div>

      <div className="min-w-0">
        <div className="truncate font-medium text-slate-950">{report.site?.name || 'Объект не указан'}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{report.equipment?.name || 'Установка не указана'}</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate font-medium text-slate-800">{report.user?.name || 'Неизвестный'}</span>
        </div>
        <div className="mt-0.5 truncate text-2xs text-slate-400">{formatLastEditor(report)}</div>
        <span className={cn(
          'mt-0.5 inline-block rounded px-1.5 py-0.5 text-3xs font-medium',
          report.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
        )}>{statusLabel(report.status)}</span>
      </div>

      <MetricCell value={formatNumber(totals.piles)} sub={`${formatNumber(totals.pileMeters)} м.п.`} tone="orange" />
      <MetricCell value={formatNumber(totals.drillingCount)} sub={`${formatNumber(totals.drillingMeters)} м`} tone="blue" />
      <MetricCell value={formatHours(totals.downtimeHours)} sub={totals.downtimeHours > 0 ? 'есть' : 'нет'} tone={totals.downtimeHours > 0 ? 'amber' : 'slate'} />

      <div className="flex items-center justify-end gap-1">
        <ReportThumbnail reportId={report.reportId} />
        <IconButton label="Предпросмотр PDF" onClick={() => onPreviewPdf(report)} icon={Eye} />
        <IconButton label="Подробнее" onClick={() => onOpenDetails(report)} icon={ShieldCheck} />
        <IconButton label="Редактировать" onClick={() => onEdit(report)} icon={Pencil} />
        <IconButton label="Удалить" onClick={() => onDelete(report)} icon={Trash2} danger disabled={deleting} />
      </div>
    </div>
  );
}

function MetricCell({ value, sub, tone }: { value: string; sub: string; tone: 'orange' | 'blue' | 'amber' | 'slate' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 lg:block lg:text-right">
      <span className={cn(
        'font-mono font-semibold tabular-nums',
        tone === 'orange' && 'text-orange-700',
        tone === 'blue' && 'text-blue-700',
        tone === 'amber' && 'text-amber-700',
        tone === 'slate' && 'text-slate-700',
      )}>{value}</span>
      <span className="text-2xs text-slate-400 lg:mt-0.5 lg:block">{sub}</span>
    </div>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  danger = false,
  disabled = false,
}: {
  label: string;
  icon: typeof Eye;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50',
        danger && 'hover:bg-red-50 hover:text-red-500',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function ReportEvidencePreview({
  report,
  history,
  formatDate,
  onClose,
  onEdit,
  onPreviewPdf,
  onPrint,
}: {
  report: ReportDTO | null;
  history: { data: ReportHistory | null; loading: boolean; error: boolean };
  formatDate: (d: string) => string;
  onClose: () => void;
  onEdit: (r: ReportDTO) => void;
  onPreviewPdf: (r: ReportDTO) => void;
  onPrint: () => void;
}) {
  if (!report) {
    return (
      <aside className="min-h-56 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-sm xl:sticky xl:top-4">
        Выберите отчёт в журнале, чтобы увидеть доказательства смены.
      </aside>
    );
  }

  const totals = getReportTotals(report);
  const duration = shiftDurationHours(report);
  const efficiency = duration ? ((duration - totals.downtimeHours) / duration) * 100 : null;
  const downtimeMax = Math.max(...report.downtimes.map((item) => item.duration), 1);
  const workTotal = Math.max(totals.pileMeters + totals.drillingMeters, 1);
  return (
    <aside className="self-start rounded-lg border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-950">Отчёт #{report.reportId}</h2>
            <p className="mt-0.5 text-2xs text-slate-500">Доказательства смены · {formatDate(report.date)}</p>
            <span className={cn(
              'mt-1 inline-block rounded px-2 py-0.5 text-3xs font-medium',
              report.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
            )}>{statusLabel(report.status)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть доказательства смены"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
          <HeaderFact label="Смена" value={shiftLabel(report)} sub={report.date} />
          <HeaderFact label="Изменено" value={formatIsoDateTime(report.updatedAt)} sub={report.lastEditedByName || '-'} />
        </div>

        <div className="grid grid-cols-3 divide-x rounded-md border border-slate-200">
          <HeaderFact label="Объект" value={report.site?.name || '-'} sub="-" />
          <HeaderFact label="Установка" value={report.equipment?.name || '-'} sub="-" />
          <HeaderFact label="Оператор" value={report.user?.name || '-'} sub="-" />
        </div>

        <div>
          <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-400" />
            История изменений
          </h3>
          <div className="rounded-md border border-slate-200">
            {history.loading ? (
              <div className="px-2.5 py-3 text-2xs text-slate-400">Загрузка истории…</div>
            ) : history.error ? (
              <div className="px-2.5 py-3 text-2xs text-red-500">Не удалось загрузить историю изменений</div>
            ) : !history.data || history.data.events.length === 0 ? (
              <div className="px-2.5 py-3 text-2xs text-slate-400">Событий пока нет</div>
            ) : (
              history.data.events.map((event) => (
                <div key={event.id} className="border-b border-slate-100 px-2.5 py-2 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">{event.actionLabel}</span>
                    <span className="text-3xs text-slate-400">{formatIsoDateTime(event.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-2xs text-slate-500">
                    {event.actorName || 'Неизвестный'}{event.actorRole ? ` · ${roleLabel(event.actorRole)}` : ''}
                  </p>
                  {event.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {event.changes.map((change, i) => (
                        <li key={i} className="text-2xs text-slate-600">
                          <span className="text-slate-400">{change.label}:</span>{' '}
                          <span className="line-through decoration-slate-300">{change.before}</span>
                          {' → '}
                          <span className="font-medium text-slate-800">{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="[&_.h-32]:!h-20 [&_img]:!max-h-24 [&>div]:!rounded-md [&>div]:!p-2 [&_h3]:!text-xs">
          <PhotoSection reportId={report.reportId} canEdit={false} />
        </div>

        <div className="grid grid-cols-4 divide-x rounded-md border border-slate-200">
          <PreviewMetric icon={HardHat} label="Сваи" value={`${formatNumber(totals.piles)} шт.`} sub={`${formatNumber(totals.pileMeters)} м.п.`} />
          <PreviewMetric icon={Drill} label="Бурение" value={`${formatNumber(totals.drillingCount)} шт.`} sub={`${formatNumber(totals.drillingMeters)} м`} />
          <PreviewMetric icon={Clock} label="Простой" value={formatHours(totals.downtimeHours)} sub={totals.downtimeHours > 0 ? 'есть' : 'нет'} />
          <PreviewMetric icon={CheckCircle2} label="Эффективность" value={efficiency == null ? '-' : formatPercentValue(efficiency)} sub="без простоев" />
        </div>

        <div className="grid grid-cols-4 divide-x rounded-md border border-slate-200">
          <PlainFact label="Начало смены" value={report.shiftStart || '-'} />
          <PlainFact label="Окончание" value={report.shiftEnd || '-'} />
          <PlainFact label="Отработано" value={duration == null ? '-' : formatHours(duration)} />
          <PlainFact label="Дата" value={shortDate(report.date)} />
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {report.downtimes.length > 0 && (
            <div className="rounded-md border border-slate-200 p-2.5">
              <h3 className="mb-1.5 text-xs font-semibold text-slate-900">Простои по причинам</h3>
              <div className="space-y-1">
                {report.downtimes.slice(0, 3).map((downtime) => (
                  <ProgressLine
                    key={downtime.id}
                    label={downtime.reason?.name || 'Причина не указана'}
                    value={formatHours(downtime.duration)}
                    pct={(downtime.duration / downtimeMax) * 100}
                    tone="amber"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border border-slate-200 p-2.5">
            <h3 className="mb-1.5 text-xs font-semibold text-slate-900">Типы работ</h3>
            <div className="space-y-1">
              <ProgressLine label="Сваи" value={`${formatNumber(totals.pileMeters)} м.п.`} pct={(totals.pileMeters / workTotal) * 100} tone="orange" />
              <ProgressLine label="Бурение" value={`${formatNumber(totals.drillingMeters)} м`} pct={(totals.drillingMeters / workTotal) * 100} tone="blue" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button onClick={() => onPreviewPdf(report)} className="h-9 min-w-0 bg-orange-500 px-2 text-xs text-white hover:bg-orange-600">
            <FileDown className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">Открыть PDF</span>
          </Button>
          <Button onClick={() => onPreviewPdf(report)} variant="outline" className="h-9 min-w-0 px-2 text-xs">
            <Download className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">Скачать</span>
          </Button>
          <Button onClick={onPrint} variant="outline" className="h-9 min-w-0 px-2 text-xs">
            <Printer className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">Печать</span>
          </Button>
          <Button onClick={() => onEdit(report)} variant="outline" className="h-9 min-w-0 px-2 text-xs">
            <Pencil className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">Редактировать</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}

function HeaderFact({ label, value, sub }: { label: string; value: ReactNode; sub: string }) {
  return (
    <div className="min-w-0 p-2">
      <p className="mb-0.5 text-3xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="truncate text-xs font-semibold text-slate-900">{value}</div>
      <p className="mt-0.5 truncate text-3xs text-slate-400">{sub}</p>
    </div>
  );
}

function PlainFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 p-2">
      <p className="mb-0.5 text-3xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate font-mono text-xs font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ProgressLine({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: 'amber' | 'blue' | 'orange' }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-2 text-2xs">
        <span className="truncate text-slate-600">{label}</span>
        <span className="font-mono text-slate-500">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'amber' && 'bg-amber-500',
            tone === 'blue' && 'bg-blue-500',
            tone === 'orange' && 'bg-orange-500',
          )}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

function PreviewMetric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-2">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-3xs uppercase tracking-wide text-slate-400">{label}</span>
        <Icon className="h-3.5 w-3.5 text-slate-400" />
      </div>
      <div className="font-mono text-sm font-semibold tabular-nums text-slate-950">{value}</div>
      <div className="text-3xs text-slate-400">{sub}</div>
    </div>
  );
}
