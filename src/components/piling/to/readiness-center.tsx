'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { PilingIcon } from '@/components/piling/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type EquipmentReadiness,
  type EvidenceState,
  type ReadinessStatus,
} from './readiness-model';
import {
  type EquipmentOption,
  fmtDate,
  STATUS_LABEL,
  TYPE_LABEL,
} from './to-module-bits';
import { type JournalRecord, dueText, isInspectionRecord } from './to-stats';

interface ReadinessCenterProps {
  equipment: EquipmentOption[];
  selected: EquipmentOption | null;
  selectedId: string;
  onSelect: (id: string) => void;
  readinessByEquipment: Record<string, EquipmentReadiness>;
  records: JournalRecord[];
  loading: boolean;
}

const STATUS_META: Record<ReadinessStatus, { label: string; cls: string; dot: string }> = {
  IN_REPAIR: {
    label: 'В ремонте',
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
  },
  BLOCKED: {
    label: 'Заблокировано',
    cls: 'border-rose-200 bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
  },
  OVERDUE: {
    label: 'ТО просрочено',
    cls: 'border-red-200 bg-red-50 text-red-700',
    dot: 'bg-red-500',
  },
  NO_DATA: {
    label: 'Нет данных',
    cls: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-slate-400',
  },
  ATTENTION: {
    label: 'Требует внимания',
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  READY: {
    label: 'Готово',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
};

const EVIDENCE_META: Record<EvidenceState, { icon: typeof CheckCircle2; cls: string }> = {
  pass: { icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  warning: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  missing: { icon: Clock, cls: 'border-border bg-muted text-muted-foreground' },
  block: { icon: ShieldAlert, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};

const DECISION_CHAIN: ReadinessStatus[] = [
  'IN_REPAIR',
  'BLOCKED',
  'OVERDUE',
  'NO_DATA',
  'ATTENTION',
  'READY',
];

export function ReadinessCenter({
  equipment,
  selected,
  selectedId,
  onSelect,
  readinessByEquipment,
  records,
  loading,
}: ReadinessCenterProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReadinessStatus | 'ALL'>('ALL');

  const filteredEquipment = useMemo(() => {
    const text = query.trim().toLowerCase();
    return equipment.filter((item) => {
      const readiness = readinessByEquipment[item.id];
      const matchesText = !text
        || item.name.toLowerCase().includes(text)
        || item.model?.toLowerCase().includes(text);
      const matchesStatus = statusFilter === 'ALL' || readiness?.status === statusFilter;
      return matchesText && matchesStatus;
    });
  }, [equipment, query, readinessByEquipment, statusFilter]);

  const readiness = selected ? readinessByEquipment[selected.id] ?? null : null;
  const latestRecords = records.slice(0, 5);

  return (
    <div className="space-y-3">
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Установка или модель"
            className="h-10 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['ALL', 'READY', 'ATTENTION', 'NO_DATA', 'OVERDUE', 'IN_REPAIR'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={cn(
                'rounded-md border px-3 py-2 text-xs font-semibold transition-colors',
                statusFilter === status
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-border bg-card text-muted-foreground hover:border-orange-300',
              )}
            >
              {status === 'ALL' ? 'Все' : STATUS_META[status].label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">Парк установок</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {filteredEquipment.length} из {equipment.length}
              </p>
            </div>
            <PilingIcon name="equipment-rig" size={32} decorative />
          </div>
          <div className="max-h-[650px] divide-y divide-border overflow-y-auto">
            {loading ? (
              <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
                Сбор подтверждений…
              </div>
            ) : filteredEquipment.length === 0 ? (
              <div className="grid min-h-40 place-items-center px-6 text-center text-sm text-muted-foreground">
                Установки по фильтру не найдены
              </div>
            ) : (
              filteredEquipment.map((item) => {
                const itemReadiness = readinessByEquipment[item.id];
                const status = itemReadiness?.status ?? 'NO_DATA';
                const meta = STATUS_META[status];
                const active = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors hover:bg-orange-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500',
                      active && 'bg-orange-50/70 ring-1 ring-inset ring-orange-200',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-foreground">{item.name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.model || 'модель не указана'}
                        </div>
                      </div>
                      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={cn('rounded border px-2 py-1 text-2xs font-semibold', meta.cls)}>
                        {meta.label}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {itemReadiness?.score != null ? `${itemReadiness.score}/100` : '—'}
                      </span>
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {itemReadiness?.nextAction ?? 'Данные ещё загружаются'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <main className="min-w-0 space-y-3">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-bold text-foreground">
                    {selected?.name ?? 'Установка не выбрана'}
                  </h2>
                  {selected?.model && (
                    <span className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {selected.model}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Решение строится только на фактически загруженных подтверждениях.
                </p>
              </div>
              {readiness && (
                <span className={cn('rounded-md border px-3 py-2 text-xs font-bold', STATUS_META[readiness.status].cls)}>
                  {STATUS_META[readiness.status].label}
                </span>
              )}
            </div>

            {readiness ? (
              <div
                className={cn(
                  'mt-4 rounded-xl border p-4',
                  readiness.canOperate
                    ? 'border-emerald-200 bg-emerald-50'
                    : readiness.status === 'ATTENTION'
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-rose-200 bg-rose-50',
                )}
              >
                <div className="flex items-start gap-3">
                  {readiness.canOperate ? (
                    <ShieldCheck className="h-10 w-10 shrink-0 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="h-10 w-10 shrink-0 text-rose-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Решение на текущий момент
                    </div>
                    <div className="mt-1 text-xl font-bold text-foreground">
                      {readiness.canOperate ? 'Работа разрешена' : 'Запуск не подтверждён'}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground">{readiness.reason}</p>
                    <Button asChild size="sm" className="mt-3 bg-orange-500 text-white hover:bg-orange-600">
                      <Link href={readiness.nextActionHref}>{readiness.nextAction}</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid min-h-40 place-items-center rounded-xl bg-muted text-sm text-muted-foreground">
                Выберите установку
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Доказательства решения</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Факт, состояние и переход к источнику</p>
              </div>
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div className="divide-y divide-border">
              {readiness?.evidence.map((item) => {
                const meta = EVIDENCE_META[item.state];
                const Icon = meta.icon;
                const content = (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg border', meta.cls)}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
                      <div className="mt-0.5 text-sm font-semibold text-foreground">{item.value}</div>
                    </div>
                    {item.href && <span className="text-xs font-semibold text-signal-strong">Открыть</span>}
                  </div>
                );
                return item.href ? (
                  <Link key={item.key} href={item.href} className="block hover:bg-orange-50/30">
                    {content}
                  </Link>
                ) : (
                  <div key={item.key}>{content}</div>
                );
              })}
              {!readiness && (
                <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
                  Нет выбранной установки
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Последние записи</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Осмотры, ТО, ремонты и неисправности</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/to?view=journal">Весь журнал</Link>
              </Button>
            </div>
            {latestRecords.length === 0 ? (
              <div className="grid min-h-28 place-items-center px-6 text-center text-sm text-muted-foreground">
                Записей по выбранной установке нет
              </div>
            ) : (
              <div className="divide-y divide-border">
                {latestRecords.map((record) => (
                  <Link
                    key={record.id}
                    href={isInspectionRecord(record) && record.inspection
                      ? `/inspections/${record.inspection.id}`
                      : '/admin/maintenance'}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-orange-50/30"
                  >
                    <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                      {fmtDate(record.completedAt ?? record.scheduledAt ?? record.createdAt)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">{record.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {TYPE_LABEL[record.type] ?? record.type} · {dueText(record.scheduledAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {STATUS_LABEL[record.status] ?? record.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="min-w-0 space-y-3">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Цепочка статуса</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Приоритет правил сверху вниз</p>
              </div>
              <Gauge className="h-5 w-5 text-blue-600" />
            </div>
            <div className="mt-4 space-y-1.5">
              {DECISION_CHAIN.map((status, index) => {
                const active = readiness?.status === status;
                const meta = STATUS_META[status];
                return (
                  <div
                    key={status}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                      active ? meta.cls : 'border-border bg-muted/60 text-muted-foreground',
                    )}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-current font-mono text-2xs font-bold">
                      {index + 1}
                    </span>
                    <span className="flex-1 text-xs font-semibold">{meta.label}</span>
                    {active && <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} />}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-bold text-foreground">Границы решения</h3>
            <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                «Готово» означает, что обязательные данные на текущую смену собраны и явных блокеров нет.
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                Наряд-допуск и подтверждённая передача смены пока не представлены отдельными сущностями — они не учитываются как выполненные.
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-bold text-foreground">Рабочие действия</h3>
            <div className="mt-3 grid gap-2">
              <Button asChild className="justify-start bg-orange-500 text-white hover:bg-orange-600">
                <Link href={selected ? `/inspections/new?equipmentId=${selected.id}` : '/inspections/new'}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Начать осмотр
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/admin/maintenance">
                  <Wrench className="mr-2 h-4 w-4" /> Наряды и ремонты
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/admin/checklists">
                  <FileText className="mr-2 h-4 w-4" /> Шаблоны чек-листов
                </Link>
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
