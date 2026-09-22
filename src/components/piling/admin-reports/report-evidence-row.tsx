'use client';

/**
 * Презентация журнала отчётов: шапка экрана, KPI-сводка и строка отчёта
 * с действиями. Выделено из admin-reports.tsx (аудит A-8).
 */

import {
  Clock,
  Download,
  Drill,
  Eye,
  FileText,
  HardHat,
  Image as ImageIcon,
  Pencil,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import type { ReportDTO } from '@/lib/types';
import { getReportTotals, type ReportTotals } from './report-totals';
import { ReportThumbnail } from './report-thumbnail';
import { statusLabel } from '@/services/reports/report-history';
import { shortDate, shiftLabel } from './report-list-format';
import { formatDowntimeHours } from '@/lib/downtime-hours';

export function ReportsHeader({
  reportWord,
  onPrint,
  onExport,
  onExportXlsx,
  exporting,
  onCreate,
}: {
  reportWord: string;
  onPrint: () => void;
  onExport?: () => void;
  onExportXlsx?: () => void;
  exporting: boolean;
  onCreate?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <FileText className="h-5 w-5 text-signal-strong" />
            Отчёты
          </h1>
          <Badge variant="outline" className="border-border bg-card font-mono text-3xs text-muted-foreground">
            {reportWord}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Журнал смен, работ, простоев и подтверждений</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Button
          onClick={onPrint}
          variant="outline"
          className="h-10 border-border bg-card text-foreground"
        >
          <Printer className="mr-1.5 h-4 w-4" />
          Печать
        </Button>
        {onExport && <Button
          onClick={onExport}
          disabled={exporting}
          variant="outline"
          className="h-10 border-border bg-card text-foreground"
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exporting ? 'Готовим…' : 'CSV'}
        </Button>}
        {onExportXlsx && <Button
          onClick={onExportXlsx}
          disabled={exporting}
          variant="outline"
          className="h-10 border-border bg-card text-foreground"
        >
          <Download className="mr-1.5 h-4 w-4" />
          {exporting ? 'Готовим…' : 'Excel'}
        </Button>}
        {onCreate && <Button
          onClick={onCreate}
          className="h-10 bg-signal text-white hover:bg-signal-strong"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Новый отчёт
        </Button>}
      </div>
    </div>
  );
}

/**
 * Итоги над журналом отчётов.
 *
 * ПОЧЕМУ ПОДПИСЬ МЕНЯЕТСЯ. Суммы считаются по загруженным строкам, а журнал
 * листается страницами. Плитки были подписаны «за выбранный срез» всегда, и
 * после одного нажатия «Загрузить ещё» те же 100 отчётов превращались в 200, а
 * сваи — с 821 в 2320. Руководитель читал первую сотню как весь срез.
 *
 * Пока подгружено не всё, плитки честно говорят, по скольким отчётам из
 * скольких они посчитаны. Полный подсчёт на сервере по всему отбору — работа
 * отдельная: три быстрых фильтра (простой, с фото, изменены админом) сейчас
 * применяются на экране, и перенос их в запрос меняет устройство экрана.
 */
export function EvidenceSummary({ reportCount, totals, photoCount, totalReports, complete }: {
  reportCount: number;
  totals: ReportTotals;
  photoCount: number;
  /** Сколько отчётов под отбором всего, по данным сервера. */
  totalReports: number;
  /** Загружен ли весь отбор: только тогда суммы описывают его целиком. */
  complete: boolean;
}) {
  const scope = complete
    ? 'за выбранный срез'
    : `по загруженным ${reportCount} из ${totalReports}`;
  const items = [
    {
      label: 'Отчёты',
      value: complete ? String(reportCount) : `${reportCount} / ${totalReports}`,
      icon: FileText,
      detail: complete ? 'за выбранный срез' : 'загружено из отбора',
      tone: 'slate',
    },
    { label: 'Сваи', value: formatNumber(totals.piles), icon: HardHat, detail: `${formatNumber(totals.pileMeters)} м.п. · ${scope}`, tone: 'orange' },
    { label: 'Бурение', value: formatNumber(totals.drillingCount), icon: Drill, detail: `${formatNumber(totals.drillingMeters)} м · ${scope}`, tone: 'blue' },
    { label: 'Простой', value: formatDowntimeHours(totals.downtimeHours), icon: Clock, detail: scope, tone: 'amber' },
    { label: 'Фото', value: String(photoCount), icon: ImageIcon, detail: `отчётов с фото · ${scope}`, tone: 'emerald' },
  ];

  return (
    <div className="space-y-2">
      <div className={KPI_GRID} style={kpiGridStyle(items.length)}>
        {items.map((item) => (
          <KpiTile key={item.label} icon={item.icon} label={item.label} value={item.value} detail={item.detail} />
        ))}
      </div>
      {!complete ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-2xs font-medium text-warning-strong">
          Суммы посчитаны по загруженным {reportCount} отчётам из {totalReports}.
          Нажмите «Загрузить ещё отчёты» внизу списка, чтобы получить итог по всему отбору.
        </p>
      ) : null}
    </div>
  );
}

export function EvidenceReportRow({
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
  onEdit?: (r: ReportDTO) => void;
  onPreviewPdf: (r: ReportDTO) => void;
  onDelete?: (r: ReportDTO) => void;
}) {
  const totals = getReportTotals(report);

  return (
    <div
      className={cn(
        'grid gap-3 px-3 py-3 text-sm transition-colors hover:bg-signal/10/30 lg:grid-cols-[116px_minmax(170px,1.2fr)_minmax(150px,1fr)_86px_92px_86px_152px] lg:items-center',
        active && 'bg-signal/10/70 ring-1 ring-inset ring-signal/30',
      )}
    >
      <div className="flex items-center justify-between gap-3 lg:block">
        <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{shortDate(report.date)}</div>
        <div className="mt-0.5 text-2xs text-muted-foreground">{shiftLabel(report)}</div>
      </div>

      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{report.site?.name || 'Объект не указан'}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{report.equipment?.name || 'Установка не указана'}</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{report.user?.name || 'Неизвестный'}</span>
        </div>
        <div className="mt-0.5 truncate text-2xs text-muted-foreground">{formatLastEditor(report)}</div>
        <span className={cn(
          'mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium',
          report.status === 'submitted'
            ? 'bg-success/10 text-success-strong'
            : 'bg-muted text-foreground',
        )}>{statusLabel(report.status)}</span>
      </div>

      <MetricCell value={formatNumber(totals.piles)} sub={`${formatNumber(totals.pileMeters)} м.п.`} tone="orange" />
      <MetricCell value={formatNumber(totals.drillingCount)} sub={`${formatNumber(totals.drillingMeters)} м`} tone="blue" />
      <MetricCell value={formatDowntimeHours(totals.downtimeHours)} sub={totals.downtimeHours > 0 ? 'есть' : 'нет'} tone={totals.downtimeHours > 0 ? 'amber' : 'slate'} />

      <div className="grid grid-cols-3 justify-items-end gap-1">
        <ReportThumbnail reportId={report.reportId} mediaId={report.thumbnailMediaId ?? null} />
        <IconButton label="Показать в правой панели" onClick={() => onSelect(report)} icon={FileText} />
        <IconButton label="Предпросмотр PDF" onClick={() => onPreviewPdf(report)} icon={Eye} />
        <IconButton label="Подробнее" onClick={() => onOpenDetails(report)} icon={ShieldCheck} />
        {onEdit && <IconButton label="Редактировать" onClick={() => onEdit(report)} icon={Pencil} />}
        {onDelete && <IconButton label="Удалить" onClick={() => onDelete(report)} icon={Trash2} danger disabled={deleting} />}
      </div>
    </div>
  );
}

function MetricCell({ value, sub, tone }: { value: string; sub: string; tone: 'orange' | 'blue' | 'amber' | 'slate' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 lg:block lg:text-right">
      <span className={cn(
        'font-mono font-semibold tabular-nums',
        tone === 'orange' && 'text-signal-strong',
        tone === 'blue' && 'text-info-strong',
        tone === 'amber' && 'text-warning-strong',
        tone === 'slate' && 'text-foreground',
      )}>{value}</span>
      <span className="text-2xs text-muted-foreground lg:mt-0.5 lg:block">{sub}</span>
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
        'grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
        danger && 'hover:bg-destructive/10 hover:text-destructive-strong',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
