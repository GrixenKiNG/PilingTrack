'use client';

/**
 * Панель «Доказательства смены» (правая колонка журнала отчётов): шапка,
 * история изменений, фото, метрики, простои и действия по отчёту.
 * Выделено из admin-reports.tsx (аудит A-8).
 */

import { type ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Drill,
  FileDown,
  FileText,
  HardHat,
  History,
  Pencil,
  Printer,
  X,
} from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { PhotoSection } from '@/components/piling/report-form/photo-section';
import { cn } from '@/lib/utils';
import { formatNumber, formatHours } from '@/lib/format';
import type { ReportDTO } from '@/lib/types';
import { getReportTotals, shiftDurationHours } from './report-totals';
import { statusLabel, type ReportHistory } from '@/services/reports/report-history';
import {
  formatIsoDateTime,
  formatPercentValue,
  roleLabel,
  shiftLabel,
  shortDate,
} from './report-list-format';

export function ReportEvidencePreview({
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
      <aside className="min-h-56 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground shadow-sm xl:sticky xl:top-4">
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
    <aside className="self-start rounded-lg border border-border bg-card shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">Отчёт #{report.reportId}</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">Доказательства смены · {formatDate(report.date)}</p>
            <span className={cn(
              'mt-1 inline-block rounded px-2 py-0.5 text-3xs font-medium',
              report.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground',
            )}>{statusLabel(report.status)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть доказательства смены"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 divide-x rounded-md border border-border bg-muted">
          <HeaderFact label="Смена" value={shiftLabel(report)} sub={report.date} />
          <HeaderFact label="Изменено" value={formatIsoDateTime(report.updatedAt)} sub={report.lastEditedByName || '-'} />
        </div>

        <div className="grid grid-cols-3 divide-x rounded-md border border-border">
          <HeaderFact label="Объект" value={report.site?.name || '-'} sub="-" />
          <HeaderFact label="Установка" value={report.equipment?.name || '-'} sub="-" />
          <HeaderFact label="Оператор" value={report.user?.name || '-'} sub="-" />
        </div>

        <div>
          <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
            <History className="h-4 w-4 text-muted-foreground" />
            История изменений
          </h3>
          <div className="rounded-md border border-border">
            {history.loading ? (
              <div className="px-2.5 py-3 text-2xs text-muted-foreground">Загрузка истории…</div>
            ) : history.error ? (
              <div className="px-2.5 py-3 text-2xs text-red-500">Не удалось загрузить историю изменений</div>
            ) : !history.data || history.data.events.length === 0 ? (
              <div className="px-2.5 py-3 text-2xs text-muted-foreground">Событий пока нет</div>
            ) : (
              history.data.events.map((event) => (
                <div key={event.id} className="border-b border-border px-2.5 py-2 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{event.actionLabel}</span>
                    <span className="text-3xs text-muted-foreground">{formatIsoDateTime(event.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {event.actorName || 'Неизвестный'}{event.actorRole ? ` · ${roleLabel(event.actorRole)}` : ''}
                  </p>
                  {event.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {event.changes.map((change, i) => (
                        <li key={i} className="text-2xs text-muted-foreground">
                          <span className="text-muted-foreground">{change.label}:</span>{' '}
                          <span className="line-through decoration-slate-300">{change.before}</span>
                          {' → '}
                          <span className="font-medium text-foreground">{change.after}</span>
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

        <div className="grid grid-cols-4 divide-x rounded-md border border-border">
          <PreviewMetric icon={HardHat} label="Сваи" value={`${formatNumber(totals.piles)} шт.`} sub={`${formatNumber(totals.pileMeters)} м.п.`} />
          <PreviewMetric icon={Drill} label="Бурение" value={`${formatNumber(totals.drillingCount)} шт.`} sub={`${formatNumber(totals.drillingMeters)} м`} />
          <PreviewMetric icon={Clock} label="Простой" value={formatHours(totals.downtimeHours)} sub={totals.downtimeHours > 0 ? 'есть' : 'нет'} />
          <PreviewMetric icon={CheckCircle2} label="Эффективность" value={efficiency == null ? '-' : formatPercentValue(efficiency)} sub="без простоев" />
        </div>

        <div className="grid grid-cols-4 divide-x rounded-md border border-border">
          <PlainFact label="Начало смены" value={report.shiftStart || '-'} />
          <PlainFact label="Окончание" value={report.shiftEnd || '-'} />
          <PlainFact label="Отработано" value={duration == null ? '-' : formatHours(duration)} />
          <PlainFact label="Дата" value={shortDate(report.date)} />
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          {report.downtimes.length > 0 && (
            <div className="rounded-md border border-border p-2.5">
              <h3 className="mb-1.5 text-xs font-semibold text-foreground">Простои по причинам</h3>
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

          <div className="rounded-md border border-border p-2.5">
            <h3 className="mb-1.5 text-xs font-semibold text-foreground">Типы работ</h3>
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
      <p className="mb-0.5 text-3xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="truncate text-xs font-semibold text-foreground">{value}</div>
      <p className="mt-0.5 truncate text-3xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function PlainFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 p-2">
      <p className="mb-0.5 text-3xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xs font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ProgressLine({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: 'amber' | 'blue' | 'orange' }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between gap-2 text-2xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
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
    <div className="rounded-md border border-border p-2">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-3xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-3xs text-muted-foreground">{sub}</div>
    </div>
  );
}
