'use client';

/**
 * EquipmentDetail — full passport view for /admin/equipment/[id].
 *
 * Read-only layout with five sections, all driven by one
 * GET /api/equipment/:id/details call:
 *   1. Header + edit button
 *   2. Текущая работа (active crew, current site)
 *   3. 30 дней активности (KPI + timeline)
 *   4. Технический паспорт (template A/B/C grid)
 *   5. Телематика + Документы (empty states for now)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Wrench, MapPin, Users, Radio, FileText, Calendar, Activity } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { KIND_LABELS } from '../equipment-form';
import { EditEquipmentDialog } from '../equipment-dialogs';
import type { EquipmentDTO, EquipmentKindDTO } from '@/lib/types';

interface DetailsResponse {
  equipment: EquipmentDTO & Record<string, unknown>;
  crew: {
    id: string;
    name: string;
    operator: { id: string; name: string; email?: string };
    site: { id: string; name: string };
    assistants: Array<{ id: string; name: string }>;
  } | null;
  telematicsDevices: Array<{
    id: string;
    label: string;
    provider: string;
    model: string | null;
    status: string;
    lastSeenAt: string | null;
    imei: string | null;
    installedAt: string | null;
  }>;
  documents: Array<{
    id: string;
    type: string;
    title: string;
    issuedAt: string | null;
    expiresAt: string | null;
    notes: string;
  }>;
  stats30d: {
    reportCount: number;
    piles: number;
    drillingMeters: number;
    downtimeMinutes: number;
  };
  timeline: Array<{
    reportId: string;
    date: string;
    shiftType: string;
    status: string;
    siteName: string | null;
    operatorName: string | null;
    updatedAt: string;
    piles: number | null;
    drillingMeters: number | null;
    downtimeMinutes: number | null;
  }>;
}

const KIND_BADGE_STYLE: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'bg-amber-100 text-amber-700 border-amber-200',
  DRILLING_RIG: 'bg-blue-100 text-blue-700 border-blue-200',
  VIBRO_HAMMER: 'bg-violet-100 text-violet-700 border-violet-200',
  HYBRID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  OTHER: 'bg-slate-100 text-slate-600 border-slate-200',
};

interface Props {
  equipmentId: string;
}

export function EquipmentDetail({ equipmentId }: Props) {
  const [details, setDetails] = useState<DetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/details`);
      if (!res.ok) {
        setError(`Сервер вернул ${res.status}`);
        return;
      }
      setDetails(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleEditSubmit = async (id: string, payload: Record<string, unknown>) => {
    const res = await authFetch(`/api/equipment/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сохранения');
    }
    await refresh();
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="p-6">
        <BackLink />
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Не удалось загрузить установку: {error || 'нет данных'}
        </div>
      </div>
    );
  }

  const eq = details.equipment;
  const kind = (eq.kind as EquipmentKindDTO) || 'OTHER';

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <BackLink />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{eq.name}</h1>
            <Badge variant="outline" className={cn('font-normal', KIND_BADGE_STYLE[kind])}>
              {KIND_LABELS[kind]}
            </Badge>
            {!eq.isActive && (
              <Badge variant="secondary" className="bg-slate-100 text-slate-500 border-slate-200">
                Неактивна
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-slate-500">
            {eq.model && <span>{eq.model}</span>}
            {eq.manufactureYear && <span className="font-mono">{eq.manufactureYear} г.в.</span>}
            {eq.inventoryNumber && <span className="font-mono">инв. {eq.inventoryNumber}</span>}
            {eq.registrationNumber && <span className="font-mono">{eq.registrationNumber}</span>}
          </div>
        </div>
        <Button onClick={() => setEditOpen(true)} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Pencil className="w-4 h-4 mr-1.5" /> Редактировать
        </Button>
      </div>

      {/* Current crew + site */}
      <Section icon={Users} title="Текущая работа">
        {details.crew ? (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <KV label="Бригада" value={details.crew.name || '—'} />
            <KV label="Объект" value={
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                {details.crew.site.name}
              </span>
            } />
            <KV label="Оператор" value={details.crew.operator.name} />
            {details.crew.assistants.length > 0 && (
              <KV
                label="Помощники"
                value={details.crew.assistants.map((a) => a.name).join(', ')}
                full
              />
            )}
          </dl>
        ) : (
          <EmptyState message="Установка не закреплена за активной бригадой." />
        )}
      </Section>

      {/* 30-day activity */}
      <Section icon={Activity} title="30 дней активности">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Отчётов" value={details.stats30d.reportCount} />
          <Metric label="Свай" value={details.stats30d.piles} />
          <Metric label="Бурение, м" value={formatNumber(details.stats30d.drillingMeters, 1)} />
          <Metric label="Простой" value={formatMinutes(details.stats30d.downtimeMinutes)} />
        </div>

        {details.timeline.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Дата</th>
                  <th className="px-3 py-2 text-left">Смена</th>
                  <th className="px-3 py-2 text-left">Объект</th>
                  <th className="px-3 py-2 text-left">Оператор</th>
                  <th className="px-3 py-2 text-right">Свай</th>
                  <th className="px-3 py-2 text-right">Бурение</th>
                  <th className="px-3 py-2 text-right">Простой</th>
                </tr>
              </thead>
              <tbody>
                {details.timeline.map((row) => (
                  <tr key={row.reportId} className="border-t hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-mono">{formatRuDate(row.date)}</td>
                    <td className="px-3 py-2 text-xs">
                      <ShiftBadge type={row.shiftType} />
                    </td>
                    <td className="px-3 py-2">{row.siteName ?? '—'}</td>
                    <td className="px-3 py-2">{row.operatorName ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.piles ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {row.drillingMeters != null ? formatNumber(row.drillingMeters, 1) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {row.downtimeMinutes != null ? formatMinutes(row.downtimeMinutes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="За последние 30 дней отчётов по этой установке нет." />
        )}
      </Section>

      {/* Технический паспорт */}
      <Section icon={Wrench} title="Технический паспорт">
        <PassportGrid eq={eq} />
      </Section>

      {/* Телематика */}
      <Section icon={Radio} title="Телематика">
        {details.telematicsDevices.length > 0 ? (
          <div className="space-y-2">
            {details.telematicsDevices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{d.label}</div>
                  <div className="text-xs text-slate-500">
                    {d.provider}{d.model ? ` · ${d.model}` : ''}{d.imei ? ` · IMEI ${d.imei}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <TelematicsStatusBadge status={d.status} />
                  {d.lastSeenAt && <span className="text-slate-500">last seen {formatRelative(d.lastSeenAt)}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="Телематический бокс не установлен. Подключим когда поставим Teltonika / Galileosky." />
        )}
      </Section>

      {/* Документы */}
      <Section icon={FileText} title="Документы">
        {details.documents.length > 0 ? (
          <ul className="space-y-2">
            {details.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{d.title}</div>
                  <div className="text-xs text-slate-500">
                    <DocumentTypeBadge type={d.type} />
                    {d.issuedAt && (<> · выдан {formatRuDate(d.issuedAt.slice(0, 10))}</>)}
                  </div>
                  {d.notes && <div className="text-xs text-slate-400 mt-0.5">{d.notes}</div>}
                </div>
                <ExpiresIndicator iso={d.expiresAt} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="Документы не загружены (паспорт, ОТС, страховка, акты ТО). Загрузка файлов появится в следующей итерации." />
        )}
      </Section>

      <EditEquipmentDialog
        open={editOpen}
        item={eq as EquipmentDTO}
        onOpenChange={setEditOpen}
        onSubmit={handleEditSubmit}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

function Section({
  icon: Icon, title, children,
}: { icon: typeof Wrench; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <Icon className="w-4 h-4" /> {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}

function KV({ label, value, full = false }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn(full && 'sm:col-span-3')}>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">{message}</p>;
}

function BackLink() {
  return (
    <Link
      href="/admin/equipment"
      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
    >
      <ArrowLeft className="w-3 h-3" /> К списку установок
    </Link>
  );
}

function ShiftBadge({ type }: { type: string }) {
  if (type === 'NIGHT') {
    return <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">Ночь</span>;
  }
  return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">День</span>;
}

function TelematicsStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE:     'bg-emerald-100 text-emerald-700',
    PROVISIONED: 'bg-slate-100 text-slate-600',
    DEGRADED:   'bg-amber-100 text-amber-700',
    OFFLINE:    'bg-rose-100 text-rose-700',
    ARCHIVED:   'bg-slate-100 text-slate-400',
  };
  return <span className={cn('rounded px-1.5 py-0.5', map[status] || 'bg-slate-100 text-slate-600')}>{status}</span>;
}

function DocumentTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    PASSPORT: 'Паспорт',
    OTS: 'ОТС',
    INSURANCE: 'Страховка',
    INSPECTION: 'Тех. осмотр',
    CERTIFICATE: 'Сертификат',
    MAINTENANCE_LOG: 'Журнал ТО',
    OTHER: 'Прочее',
  };
  return <span className="font-medium text-slate-600">{map[type] ?? type}</span>;
}

function ExpiresIndicator({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">Истёк {Math.abs(days)} дн. назад</span>;
  if (days <= 30) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Истекает через {days} дн.</span>;
  return <span className="text-xs text-slate-400">до {formatRuDate(iso.slice(0, 10))}</span>;
}

// --------------------------------------------------------------------------
// Passport grid — only shows filled fields
// --------------------------------------------------------------------------

function PassportGrid({ eq }: { eq: EquipmentDTO & Record<string, unknown> }) {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: String(value) });
  };
  const pushNum = (label: string, value: unknown, suffix: string) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: `${formatNumber(Number(value), 1)} ${suffix}` });
  };
  const pushInt = (label: string, value: unknown, suffix: string) => {
    if (value === null || value === undefined) return;
    rows.push({ label, value: `${value} ${suffix}` });
  };
  const pushDate = (label: string, value: unknown) => {
    if (!value) return;
    const iso = typeof value === 'string' ? value : String(value);
    rows.push({ label, value: formatRuDate(iso.slice(0, 10)) });
  };

  // A
  push('Серийный номер', eq.serialNumber);
  push('VIN', eq.vin);
  push('Базовая машина', eq.baseVehicle);
  // B
  pushNum('Вес', eq.weightTons, 'т');
  pushNum('Вес с оборудованием', eq.weightWithEquipmentTons, 'т');
  pushInt('Высота', eq.heightMm, 'мм');
  pushInt('Длина', eq.lengthMm, 'мм');
  pushInt('Ширина', eq.widthMm, 'мм');
  push('Марка двигателя', eq.engineBrand);
  push('Номер двигателя', eq.engineSerialNumber);
  pushInt('Мощность двигателя', eq.enginePower, 'кВт');
  pushNum('Макс. длина сваи', eq.maxPileLength, 'м');
  pushNum('Макс. глубина бурения', eq.maxDrillingDepth, 'м');
  push('Тип молота', eq.hammerType);
  push('Серийник молота', eq.hammerSerialNumber);
  pushNum('Энергия удара', eq.hammerEnergyKj, 'кДж');
  // C
  pushDate('Дата покупки', eq.purchaseDate);
  if (eq.purchasePrice) {
    rows.push({ label: 'Стоимость покупки', value: `${formatNumber(Number(eq.purchasePrice), 2)} ₽` });
  }
  pushInt('Наработка моточасов', eq.engineHoursTotal, 'ч');
  pushInt('След. ТО по моточасам', eq.nextMaintenanceAtHours, 'ч');
  pushDate('След. ТО по дате', eq.nextMaintenanceDate);
  push('Место базирования', eq.homeBaseLocation);

  if (rows.length === 0) {
    return <EmptyState message="Паспортные данные не заполнены. Открой «Редактировать» и заполни шаблон." />;
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
      {rows.map((r, i) => (
        <div key={i}>
          <dt className="text-[11px] uppercase tracking-wide text-slate-400">{r.label}</dt>
          <dd className="mt-0.5 text-slate-900">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------

function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatMinutes(min: number): string {
  if (!min || min <= 0) return '0 мин';
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function formatRuDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
}
