'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Plus, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PdfPreviewDialog } from '@/components/piling/pdf-preview-dialog';
import { HeroKpi } from '@/components/piling/hero-kpi';
import { cn } from '@/lib/utils';
import { pluralizeRu } from '@/lib/format';
import type { ReportDTO } from '@/lib/types';
import { useReportsData } from './use-reports-data';
import { ReportFilters } from './report-filters';
import { ReportListItem } from './report-list-item';
import { ReportDetailDialog } from './report-detail-dialog';
import { ReportFormDialog } from './report-form-dialog';

export function AdminReports() {
  const {
    reports, sites, operators, pileGrades, drillingTypes, downtimeReasons, equipment,
    filterSiteId, setFilterSiteId, periodFrom, setPeriodFrom, periodTo, setPeriodTo,
    periodActive, periodSummary, loading, loadingSites, loadingReferenceData,
    handleApplyPeriod, handleResetPeriod, loadReports, loadReferenceData,
  } = useReportsData();

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ReportDTO | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editReport, setEditReport] = useState<ReportDTO | null>(null);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  useEffect(() => {
    if (showCreateDialog) {
      void loadReferenceData();
    }
  }, [showCreateDialog, loadReferenceData]);

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
    } finally { setGeneratingPdf(false); }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatLastEditor = (report: ReportDTO) => {
    if (!report.lastEditedByName) return report.user?.name ? `Автор: ${report.user.name}` : 'Нет данных';
    const roleLabel = report.lastEditedByRole === 'ADMIN' ? 'Администратор'
      : report.lastEditedByRole === 'DISPATCHER' ? 'Диспетчер'
      : report.lastEditedByRole === 'ASSISTANT' ? 'Помощник' : 'Оператор';
    return `${roleLabel}: ${report.lastEditedByName}`;
  };

  const formatReportCount = (c: number) => `${c} ${pluralizeRu(c, ['отчёт', 'отчёта', 'отчётов'])}`;

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Все отчёты</h1>
        <span className="text-sm text-muted-foreground font-mono tabular-nums">{formatReportCount(reports.length)}</span>
      </div>

      {/* Hero KPI: period summary if filter active, otherwise total reports */}
      <HeroKpi
        label={periodActive ? `Сводка за период ${periodFrom} — ${periodTo}` : 'Всего отчётов'}
        value={periodActive && periodSummary ? periodSummary.reportCount : reports.length}
        unit="шт"
        icon={FileText}
        detail={
          periodActive && periodSummary ? (
            <span className="font-mono tabular-nums">
              {periodSummary.totalPiles} свай
              <span className="mx-2 text-white/50">·</span>
              {Math.round(periodSummary.totalDrilling)} м.п. бурения
              <span className="mx-2 text-white/50">·</span>
              {Math.round(periodSummary.totalDowntime)} ч простоев
            </span>
          ) : (
            <span>Используйте фильтр периода ниже для сводки и PDF-выгрузки.</span>
          )
        }
        action={periodActive ? (
          <Button
            size="sm"
            onClick={handleExportPdf}
            disabled={generatingPdf}
            className="bg-white/15 hover:bg-white/25 text-white border-0 backdrop-blur"
          >
            {generatingPdf
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Download className="w-4 h-4 mr-1.5" />PDF</>}
          </Button>
        ) : undefined}
      />

      {/* Filters */}
      <ReportFilters
        sites={sites} filterSiteId={filterSiteId} onFilterSiteChange={setFilterSiteId}
        periodFrom={periodFrom} onPeriodFromChange={setPeriodFrom}
        periodTo={periodTo} onPeriodToChange={setPeriodTo}
        periodActive={periodActive} periodSummary={periodSummary}
        onApplyPeriod={handleApplyPeriod} onResetPeriod={handleResetPeriod}
        onExportPdf={handleExportPdf} generatingPdf={generatingPdf}
      />

      {/* Action button */}
      <Button onClick={() => { setEditReport(null); setShowCreateDialog(true); }}
        className="w-full sm:w-auto h-11 bg-orange-500 hover:bg-orange-600 text-white">
        <Plus className="w-4 h-4 mr-2" />Сформировать отчёт
      </Button>

      {/* Reports List */}
      {reports.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Нет отчётов</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((report, index) => (
            <ReportListItem key={report.id} report={report} index={index}
              pileGradeNames={{}} drillTypeNames={{}} dtReasonNames={{}}
              formatDate={formatDate} formatLastEditor={formatLastEditor}
              onView={setSelectedReport}
              onEdit={(r) => { setEditReport(r); setShowCreateDialog(true); }}
              onPreviewPdf={handlePreviewPdf}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <ReportDetailDialog report={selectedReport} onClose={() => setSelectedReport(null)}
        onPreviewPdf={handlePreviewPdf} formatDate={formatDate} formatLastEditor={formatLastEditor} />

      <PdfPreviewDialog open={!!previewReportId} onOpenChange={(o) => { if (!o) setPreviewReportId(null); }}
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
