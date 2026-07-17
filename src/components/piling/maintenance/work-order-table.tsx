'use client';

/**
 * Таблица журнала нарядов ТО (левая колонка MaintenanceBoard).
 * Чистый презентационный компонент: данные и колбэки приходят сверху.
 * Выделено из maintenance-board.tsx (аудит A-8).
 */

import { CheckCircle2, FileText, Loader2, PenLine, Trash2 } from '@/components/piling/icons/unified-icons';
import { formatRuDate, formatPersonName } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  REGULAR_TYPES,
  isOverdue,
  hoursUntilMaintenance,
  currentHours,
  deadlineText,
  splitSiteName,
} from './work-order-logic';
import { TYPE_LABEL } from './maintenance-labels';
import {
  crewForRecord,
  statusView,
  type CrewAssignment,
  type WorkOrderRow,
} from './maintenance-board-model';
import { ActionIcon } from './maintenance-board-bits';

export function WorkOrderTable({
  records,
  selectedId,
  crewByEquipment,
  busyAction,
  onSelect,
  onEdit,
  onDone,
  onDelete,
}: {
  records: WorkOrderRow[];
  selectedId: string | null;
  crewByEquipment: Map<string, CrewAssignment>;
  busyAction: string | null;
  onSelect: (id: string) => void;
  onEdit: (record: WorkOrderRow) => void;
  onDone: (record: WorkOrderRow) => void;
  onDelete: (record: WorkOrderRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-2xs text-slate-600">
          <tr>
            <th className="px-2.5 py-2 font-semibold">Установка</th>
            <th className="px-2.5 py-2 font-semibold">Объект</th>
            <th className="px-2.5 py-2 font-semibold">Бригада</th>
            <th className="px-2.5 py-2 font-semibold">Тип ТО</th>
            <th className="px-2.5 py-2 font-semibold">Срок</th>
            <th className="px-2.5 py-2 font-semibold">Наработка</th>
            <th className="px-2.5 py-2 font-semibold">Ответственный</th>
            <th className="px-2.5 py-2 font-semibold">Статус</th>
            <th className="px-2.5 py-2 text-center font-semibold">Замечания</th>
            <th className="px-2.5 py-2 text-right font-semibold">Действия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {records.map((record) => {
            const crew = crewForRecord(record, crewByEquipment);
            const site = splitSiteName(crew?.site?.name);
            const dueHours = hoursUntilMaintenance(record);
            const selectedRow = record.id === selectedId;
            const badge = statusView(record);
            return (
              <tr
                key={record.id}
                onClick={() => onSelect(record.id)}
                className={cn(
                  'cursor-pointer align-top transition-colors hover:bg-orange-50/30',
                  selectedRow && 'bg-sky-50/80 outline outline-1 -outline-offset-1 outline-sky-200',
                )}
              >
                <td className="px-2.5 py-2.5">
                  <div className="font-semibold text-slate-900">{record.equipment?.name ?? '—'}</div>
                  <div className="mt-1 text-2xs text-slate-500">{record.equipment?.model ?? '№ не указан'}</div>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="font-medium text-slate-800">{site.title}</div>
                  {site.location && <div className="mt-1 text-2xs text-slate-500">{site.location}</div>}
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="max-w-32 truncate text-slate-700">{crew?.name ?? 'Без бригады'}</div>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="font-semibold text-slate-800">{TYPE_LABEL[record.type]}</div>
                  <div className="mt-1 text-2xs text-slate-500">{REGULAR_TYPES.has(record.type) ? 'регламентное' : 'ремонт'}</div>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className={cn('font-mono font-semibold text-slate-800', isOverdue(record) && 'text-red-600')}>
                    {formatRuDate(record.scheduledAt)}
                  </div>
                  <div className={cn('mt-1 text-2xs', isOverdue(record) ? 'font-semibold text-red-600' : 'text-slate-500')}>
                    {deadlineText(record)}
                  </div>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="font-mono font-semibold text-slate-800">{currentHours(record) ?? '—'} м.ч.</div>
                  <div className={cn('mt-1 text-2xs', dueHours != null && dueHours <= 10 ? 'font-semibold text-orange-600' : 'text-slate-500')}>
                    {dueHours != null ? `${dueHours >= 0 ? '+' : ''}${dueHours} м.ч.` : '—'}
                  </div>
                </td>
                <td className="px-2.5 py-2.5">
                  <div className="max-w-32 truncate text-slate-700">{formatPersonName(crew?.operator?.name)}</div>
                </td>
                <td className="px-2.5 py-2.5">
                  <span className={cn('inline-flex rounded border px-2 py-1 text-2xs font-semibold', badge.className)}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-center font-mono text-slate-800">
                  {record.faultCause ? 1 : 0}
                </td>
                <td className="px-2.5 py-2.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    <ActionIcon href={`/admin/maintenance/${record.id}`} label="Открыть" icon={FileText} />
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onEdit(record); }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
                      title="Редактировать"
                    >
                      <PenLine className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onDone(record); }}
                      disabled={busyAction === `${record.id}:DONE` || record.status === 'DONE'}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Закрыть ТО"
                    >
                      {busyAction === `${record.id}:DONE` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onDelete(record); }}
                      disabled={busyAction === `${record.id}:delete`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Удалить ТО"
                    >
                      {busyAction === `${record.id}:delete` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
