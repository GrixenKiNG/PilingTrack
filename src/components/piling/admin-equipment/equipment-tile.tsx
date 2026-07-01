'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Users, Clock, AlertTriangle, ExternalLink, Wrench, BookText, FileX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FleetCard } from './fleet-types';
import { STATUS_META, KIND_LABEL } from './equipment-status';
import { getMaintenanceFlag } from './equipment-maintenance-flag';
import { getEquipmentBrand } from './equipment-brand-logo';

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ru'));
const formatNum = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('ru', { maximumFractionDigits: digits });
const downtimeDays = (hours: number | null | undefined) => {
  if (hours == null) return '—';
  if (hours <= 0) return '0';
  return String(Math.ceil(hours / 24));
};

export function EquipmentTile({
  card,
  selected,
  onSelect,
}: {
  card: FleetCard;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const st = STATUS_META[card.status];
  const brand = getEquipmentBrand(card.model);
  const flag = getMaintenanceFlag(card);
  const t = card.todayTotals;
  const stateLabel = flag ? 'Плановое ТО' : card.status === 'active' ? 'В работе' : 'Не активна';
  const stateClass = flag
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : card.status === 'active'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-slate-200 bg-slate-50 text-slate-500';
  const barClass = flag === 'overdue' ? 'bg-rose-500' : flag === 'soon' ? 'bg-amber-500' : st.bar;

  return (
    <Card
      onClick={() => onSelect(card.id)}
      className={cn(
        'cursor-pointer gap-0 overflow-hidden p-0 transition-all hover:shadow-md',
        selected && 'ring-2 ring-blue-500/40',
      )}
    >
      <div className={cn('h-1 w-full', barClass)} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {brand && (
                <Image
                  src={brand.logoSrc}
                  alt={brand.name}
                  title={brand.name}
                  width={16}
                  height={16}
                  className="h-4 w-4 shrink-0 object-contain"
                  unoptimized
                />
              )}
              <p className="truncate text-sm font-semibold text-slate-900">{card.name}</p>
            </div>
            <p className="text-xs text-slate-500">
              {KIND_LABEL[card.kind]}
              {card.manufactureYear ? ` · ${card.manufactureYear} г.` : ''}
              {card.serialNumber ? ` · зав. ${card.serialNumber}` : ''}
            </p>
          </div>
          <Badge variant="outline" className={cn('shrink-0 font-normal', stateClass)}>
            {stateLabel}
          </Badge>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
          {card.assignedSiteName && <span className="truncate">{card.assignedSiteName}</span>}
          {card.assignedOperatorName && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {card.assignedOperatorName}
            </span>
          )}
          <span className="flex items-center gap-1 font-mono">
            <Clock className="h-3 w-3" />
            {num(card.engineHoursTotal)} ч
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="сваи шт./м.п." value={t ? `${formatNum(t.piles)} / ${formatNum(t.pileMeters, 1)}` : '—'} />
          <Metric label="бурение шт./м" value={t ? `${formatNum(t.drillingCount)} / ${formatNum(t.drillingMeters, 1)}` : '—'} />
          <Metric label="простой, дн." value={t ? downtimeDays(t.downtimeHours) : '—'} />
        </div>

        {flag ? (
          <Badge
            variant="outline"
            className={cn(
              'mt-2 font-normal',
              flag === 'overdue'
                ? 'bg-destructive/10 text-destructive border-destructive/20'
                : 'bg-warning/10 text-warning border-warning/20',
            )}
          >
            <AlertTriangle className="mr-1 h-3 w-3" />
            {flag === 'overdue' ? 'Просрочено ТО' : 'Скоро ТО'}
          </Badge>
        ) : (
          card.status === 'idle' &&
          !t && (
            <span className="mt-2 flex items-center gap-1 text-2xs text-slate-400">
              <FileX className="h-3 w-3" /> Нет отчёта
            </span>
          )
        )}

        <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
          <QuickLink href={`/admin/equipment/${card.id}`} icon={<Wrench className="h-3.5 w-3.5" />} label="ТО" />
          <QuickLink href={`/admin/equipment/${card.id}`} icon={<BookText className="h-3.5 w-3.5" />} label="Документы" />
          <Link
            href={`/admin/equipment/${card.id}`}
            aria-label="Открыть карточку"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
      <div className="font-mono text-sm font-semibold text-slate-900">{value}</div>
      <div className="text-3xs text-slate-400">{label}</div>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
    >
      {icon}
      {label}
    </Link>
  );
}
