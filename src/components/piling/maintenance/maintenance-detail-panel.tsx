'use client';

/**
 * Доказательная панель выбранного наряда ТО (правая колонка журнала):
 * назначение, наработка, исполнение, замечания, фото, влияние, таймлайн.
 * Выделено из maintenance-board.tsx (аудит A-8).
 */

import Link from 'next/link';
import { CheckCircle2, FileText, Loader2, Printer } from '@/components/piling/icons/unified-icons';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  currentHours,
  deadlineText,
  hoursUntilMaintenance,
  maintenanceInterval,
} from './work-order-logic';
import { TYPE_LABEL } from './maintenance-labels';
import { statusView, type MaintenanceCrewView, type WorkOrderRow } from './maintenance-board-model';
import { ActionIcon } from './maintenance-board-bits';
import { WorkOrderPhotos } from './work-order-photos';

export function MaintenanceDetailPanel({
  record,
  crew,
  assigneeName,
  busyAction,
  onClose,
}: {
  record: WorkOrderRow | null;
  crew: MaintenanceCrewView | null;
  assigneeName: string;
  busyAction: string | null;
  onClose: (record: WorkOrderRow) => Promise<void>;
}) {
  if (!record) {
    return (
      <aside className="border-l border-slate-200 bg-white p-5 text-sm text-slate-500">
        Выберите наряд ТО в журнале.
      </aside>
    );
  }

  const dueHours = hoursUntilMaintenance(record);
  const interval = maintenanceInterval(record);
  const hours = currentHours(record);
  const progress = hours != null && record.equipment?.nextMaintenanceAtHours
    ? Math.max(6, Math.min(100, (hours / record.equipment.nextMaintenanceAtHours) * 100))
    : 54;
  const badge = statusView(record);
  const closeBusy = busyAction === `${record.id}:DONE`;

  return (
    <aside className="min-h-screen border-l border-slate-200 bg-white">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-lg font-bold text-slate-950">ТО {record.equipment?.name ?? record.title}</h2>
              <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold', badge.className)}>
                {badge.label}
              </span>
            </div>
          </div>
          <ActionIcon href={`/admin/equipment/${record.equipmentId}`} label="Открыть карточку установки" icon={FileText} />
        </header>

        <div className="flex-1 space-y-4 px-5 py-4">
          <PanelSection title="Назначение">
            <div className="grid grid-cols-3 gap-3">
              <InfoCell label="Объект" value={crew?.site?.name ?? 'Без объекта'} />
              <InfoCell label="Бригада" value={crew?.name ?? 'Без бригады'} />
              <InfoCell label="Оператор" value={crew?.operator?.name ?? '—'} />
            </div>
          </PanelSection>

          <PanelSection title="Наработка">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <MetricLine label="Текущая наработка" value={hours != null ? `${hours} м.ч.` : '—'} />
              <MetricLine label={`До ${TYPE_LABEL[record.type]} осталось`} value={dueHours != null ? `${dueHours} м.ч.` : '—'} />
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${progress}%` }} />
              </div>
              <MetricLine label="Порог ТО" value={interval != null ? `${interval} м.ч.` : 'не задан'} />
              <MetricLine label="Закрыто" value={record.completedAt ? `${formatRuDate(record.completedAt)} (${hours ?? '—'} м.ч.)` : 'не закрывалось'} />
            </div>
          </PanelSection>

          <PanelSection title="Исполнение">
            <div className="overflow-hidden rounded-md border border-slate-200">
              <FactRow label="Диагностика" value={record.faultCause} />
              <FactRow label="Выполнено" value={record.workDone} />
              <FactRow label="Запчасти" value={record.partsUsedText} />
              <FactRow label="Трудозатраты" value={record.laborHours != null ? `${record.laborHours} ч` : null} />
              <FactRow label="Стоимость" value={record.cost != null ? `${record.cost} ₽` : null} />
            </div>
          </PanelSection>

          <PanelSection title="Замечания">
            <div className="space-y-2">
              {record.faultCause || record.partsUsedText ? (
                <>
                  {record.faultCause && <RemarkLine tone="orange" text={record.faultCause} />}
                  {record.partsUsedText && <RemarkLine tone="red" text={record.partsUsedText} />}
                </>
              ) : (
                <p className="text-xs text-slate-500">Замечания не заполнены.</p>
              )}
            </div>
          </PanelSection>

          <PanelSection title="Фото">
            <WorkOrderPhotos recordId={record.id} entityId={record.id} />
          </PanelSection>

          <PanelSection title="Влияние">
            <div className="grid grid-cols-3 gap-3">
              <InfoCell label="Риск простоя" value={deadlineText(record)} />
              <InfoCell label="Объект" value={crew?.site?.name ?? '—'} />
              <InfoCell label="Статус" value={statusView(record).label} />
            </div>
          </PanelSection>

          <PanelSection title="Состояние наряда">
            <div className="space-y-3 text-xs">
              <TimelineLine tone="green" date={formatRuDate(record.scheduledAt)} text="Плановая дата ТО" actor="План" />
              <TimelineLine tone="green" date={formatRuDate(record.startedAt)} text={record.startedAt ? 'Работы начаты' : 'Работы не начаты'} actor={assigneeName} />
              <TimelineLine tone={record.completedAt ? 'green' : 'orange'} date={formatRuDate(record.completedAt)} text={record.completedAt ? 'ТО закрыто' : 'Закрытие ожидается'} actor={assigneeName} />
            </div>
            <Link href={`/admin/maintenance/${record.id}`} className="mt-3 inline-flex text-xs font-medium text-blue-600 hover:text-blue-700">
              Показать все события
            </Link>
          </PanelSection>
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-slate-200 px-4 py-3">
          <Button
            size="sm"
            className="h-9 bg-orange-500 px-2 text-white hover:bg-orange-600"
            disabled={closeBusy || record.status === 'DONE'}
            onClick={() => void onClose(record)}
          >
            {closeBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Закрыть ТО
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 px-2"
            onClick={() => window.print()}
          >
            <Printer className="mr-1 h-4 w-4" /> Печать
          </Button>
        </footer>
      </div>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 pb-4 last:border-b-0">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs text-slate-500">{label}</div>
      <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[112px_1fr] border-b border-slate-100 text-xs last:border-b-0">
      <div className="bg-slate-50 px-2 py-1.5 font-medium text-slate-600">{label}</div>
      <div className="px-2 py-1.5 text-slate-700">{value?.toString().trim() || 'Не заполнено'}</div>
    </div>
  );
}

function RemarkLine({ tone, text }: { tone: 'orange' | 'red'; text: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-700">
      <span className={cn('h-2 w-2 rounded-full', tone === 'orange' ? 'bg-orange-500' : 'bg-red-500')} />
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  );
}

function TimelineLine({ tone, date, text, actor }: { tone: 'green' | 'orange'; date: string; text: string; actor: string }) {
  return (
    <div className="grid grid-cols-[12px_112px_1fr_88px] items-start gap-2">
      <span className={cn('mt-1.5 h-2 w-2 rounded-full', tone === 'green' ? 'bg-emerald-500' : 'bg-orange-500')} />
      <span className="font-mono text-2xs text-slate-500">{date}</span>
      <span className="text-slate-700">{text}</span>
      <span className="truncate text-right text-2xs text-slate-500">{actor}</span>
    </div>
  );
}
