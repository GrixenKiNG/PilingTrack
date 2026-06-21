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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pencil, Wrench, MapPin, Users, Radio, FileText, Activity, Camera, History, Gauge, Printer, Timer, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { KIND_LABELS } from '../equipment-form';
import { EditEquipmentDialog } from '../equipment-dialogs';
import { EquipmentPhotos } from './equipment-photos';
import { EquipmentDocuments } from './equipment-documents';
import { EquipmentMonitoring } from './equipment-monitoring';
import { EquipmentMaintenance } from './equipment-maintenance';
import { EquipmentInspections } from './equipment-inspections';
import { EquipmentReportExport } from './equipment-report-export';
import { EquipmentPlaceholder } from '../equipment-placeholder';
import {
  Section, KV, Metric, EmptyState, BackLink, TelematicsStatusBadge,
  HistoryTable, MaintenanceBlock, PassportGrid,
  formatHours, formatRelative,
  type TimelineRow,
} from './equipment-detail-parts';
import { formatFixed } from '@/lib/format';
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
    pileMeters: number;
    drillingCount: number;
    drillingMeters: number;
    downtimeHours: number;
  };
  timeline: TimelineRow[];
}

const KIND_BADGE_STYLE: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'bg-amber-100 text-amber-700 border-amber-200',
  DRILLING_RIG: 'bg-blue-100 text-blue-700 border-blue-200',
  VIBRO_HAMMER: 'bg-violet-100 text-violet-700 border-violet-200',
  HYBRID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  OTHER: 'bg-slate-100 text-slate-600 border-slate-200',
};

type TabKey =
  | 'overview' | 'work' | 'passport' | 'assignment' | 'maintenance'
  | 'documents' | 'photos' | 'history'
  | 'telemetry' | 'checklists' | 'errors';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'work', label: 'Работа' },
  { key: 'passport', label: 'Паспорт' },
  { key: 'assignment', label: 'Закрепление' },
  { key: 'maintenance', label: 'ТО' },
  { key: 'documents', label: 'Документы' },
  { key: 'photos', label: 'Фото' },
  { key: 'history', label: 'История' },
];

function OverviewHero({
  eq,
  crew,
}: {
  eq: EquipmentDTO & Record<string, unknown>;
  crew: DetailsResponse['crew'];
}) {
  const kind = ((eq.kind as EquipmentKindDTO) || 'OTHER');
  return (
    <div
      className="relative min-h-44 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 bg-cover bg-center p-4 text-white"
      style={{ backgroundImage: "linear-gradient(90deg, rgba(15,23,42,.92), rgba(15,23,42,.48), rgba(15,23,42,.14)), url('/login-bg/bg-3.png')" }}
    >
      <div className="relative z-10 flex h-full min-h-36 flex-col justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/65">{KIND_LABELS[kind]}</div>
          <h2 className="mt-1 text-xl font-bold leading-tight">{eq.name}</h2>
          <div className="mt-1 text-sm text-white/80">{eq.model || 'Модель не указана'}</div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-white/55">Объект</div>
            <div className="truncate font-medium">{crew?.site.name || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Оператор</div>
            <div className="truncate font-medium">{crew?.operator.name || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Инв. номер</div>
            <div className="truncate font-mono font-medium">{eq.inventoryNumber || '—'}</div>
          </div>
          <div>
            <div className="text-white/55">Статус</div>
            <div className="font-medium">{eq.isActive ? 'В работе' : 'Не активна'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTiles({
  eq,
  crew,
  stats,
  timeline,
  devicesCount,
}: {
  eq: EquipmentDTO & Record<string, unknown>;
  crew: DetailsResponse['crew'];
  stats: DetailsResponse['stats30d'];
  timeline: TimelineRow[];
  devicesCount: number;
}) {
  const kind = ((eq.kind as EquipmentKindDTO) || 'OTHER');
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <OverviewTile
        title="Основная информация"
        rows={[
          ['Тип техники', KIND_LABELS[kind]],
          ['Модель', eq.model || '—'],
          ['Инв. номер', eq.inventoryNumber || '—'],
          ['Объект', crew?.site.name || '—'],
          ['Оператор', crew?.operator.name || '—'],
          ['Бригада', crew?.name || '—'],
        ]}
      />
      <OverviewTile
        title="Текущее состояние"
        rows={[
          ['Статус', eq.isActive ? 'В работе' : 'Не активна'],
          ['Моточасы', eq.engineHoursTotal != null ? `${formatFixed(Number(eq.engineHoursTotal), 0)} ч` : '—'],
          ['Телематика', devicesCount > 0 ? `${devicesCount} устройств` : 'не подключена'],
          ['Последний отчёт', timeline[0]?.date || '—'],
        ]}
      />
      <OverviewTile
        title="Производительность за 30 дней"
        rows={[
          ['Сваи', `${formatFixed(stats.piles, 0)} шт. / ${formatFixed(stats.pileMeters, 1)} м.п.`],
          ['Бурение', `${formatFixed(stats.drillingCount, 0)} шт. / ${formatFixed(stats.drillingMeters, 1)} м`],
          ['Простой', formatHours(stats.downtimeHours)],
          ['Отчёты', `${stats.reportCount}`],
        ]}
      />
      <OverviewTile
        title="ТО и обслуживание"
        rows={[
          ['Ближайшее ТО', eq.nextMaintenanceDate ? String(eq.nextMaintenanceDate).slice(0, 10) : '—'],
          ['Моточасы ТО', eq.nextMaintenanceAtHours != null ? `${formatFixed(Number(eq.nextMaintenanceAtHours), 0)} ч` : '—'],
          ['Замечания', timeline.some((row) => row.downtimeHours && row.downtimeHours > 0) ? 'есть простой' : 'нет'],
        ]}
      />
    </div>
  );
}

function OverviewTile({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2 text-xs">
            <dt className="truncate text-slate-400">{label}</dt>
            <dd className="truncate text-right font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface Props {
  equipmentId: string;
  /** When rendered inside the fleet-center right column (not the full page):
   *  hides the "back" link and trims outer padding. */
  embedded?: boolean;
}

export function EquipmentDetail({ equipmentId, embedded = false }: Props) {
  const [details, setDetails] = useState<DetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('overview');

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
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
        {!embedded && <BackLink />}
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Не удалось загрузить установку: {error || 'нет данных'}
        </div>
      </div>
    );
  }

  const eq = details.equipment;
  const kind = (eq.kind as EquipmentKindDTO) || 'OTHER';

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={cn('font-bold tracking-tight text-slate-900', embedded ? 'text-lg' : 'text-2xl')}>{eq.name}</h1>
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
  );

  const editDialog = (
    <EditEquipmentDialog
      open={editOpen}
      item={eq as EquipmentDTO}
      onOpenChange={setEditOpen}
      onSubmit={handleEditSubmit}
    />
  );

  if (embedded) {
    return (
      <div className="space-y-4">
        {header}

        <div className="grid grid-cols-4 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px min-w-0 border-b-2 px-2 py-2 text-xs font-medium transition-colors',
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="pt-1">
          {tab === 'overview' && (
            <div className="space-y-4">
              <OverviewHero eq={eq} crew={details.crew} />
              <OverviewTiles eq={eq} crew={details.crew} stats={details.stats30d} timeline={details.timeline} devicesCount={details.telematicsDevices.length} />
              {details.crew ? (
                <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  <KV label="Бригада" value={details.crew.name || '—'} />
                  <KV
                    label="Объект"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-slate-400" />
                        {details.crew.site.name}
                      </span>
                    }
                  />
                  <KV label="Оператор" value={details.crew.operator.name} />
                  {details.crew.assistants.length > 0 && (
                    <KV label="Помощники" value={details.crew.assistants.map((a) => a.name).join(', ')} full />
                  )}
                </dl>
              ) : (
                <EmptyState message="Установка не закреплена за активной бригадой." />
              )}
              <PassportGrid eq={eq} />
            </div>
          )}

          {tab === 'work' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Отчётов (30д)" value={details.stats30d.reportCount} />
                <Metric label="Сваи шт./м.п." value={`${formatFixed(details.stats30d.piles, 0)} / ${formatFixed(details.stats30d.pileMeters, 1)}`} />
                <Metric label="Бурение шт./м" value={`${formatFixed(details.stats30d.drillingCount, 0)} / ${formatFixed(details.stats30d.drillingMeters, 1)}`} />
                <Metric label="Простой" value={formatHours(details.stats30d.downtimeHours)} />
              </div>
            </div>
          )}

          {tab === 'telemetry' && (
            <div className="space-y-4">
              <EquipmentMonitoring equipmentId={equipmentId} />
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
                <EquipmentPlaceholder label="Телеметрия (топливо, давление, GPS)" hint="ждёт датчик" />
              )}
            </div>
          )}

          {tab === 'passport' && <PassportGrid eq={eq} />}

          {tab === 'assignment' && (
            <div className="space-y-4">
              {details.crew ? (
                <section className="rounded-lg border border-slate-200 bg-white p-3">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Текущее закрепление</h3>
                  <dl className="grid grid-cols-1 gap-3 text-sm">
                    <KV label="Объект" value={details.crew.site.name} />
                    <KV label="Бригада" value={details.crew.name || '—'} />
                    <KV label="Оператор" value={details.crew.operator.name} />
                    {details.crew.assistants.length > 0 && (
                      <KV label="Помощники" value={details.crew.assistants.map((a) => a.name).join(', ')} full />
                    )}
                  </dl>
                </section>
              ) : (
                <EmptyState message="Установка не закреплена за активной бригадой." />
              )}
            </div>
          )}

          {tab === 'maintenance' && (
            <div className="space-y-4">
              <MaintenanceBlock eq={eq} />
              <EquipmentMaintenance equipmentId={equipmentId} />
            </div>
          )}

          {tab === 'checklists' && <EquipmentInspections equipmentId={equipmentId} />}

          {tab === 'documents' && (
            <EquipmentDocuments equipmentId={equipmentId} documents={details.documents} onChanged={refresh} />
          )}

          {tab === 'history' &&
            (details.timeline.length > 0 ? (
              <HistoryTable rows={details.timeline} />
            ) : (
              <EmptyState message="Отчётов по этой установке пока нет." />
            ))}

          {tab === 'photos' && <EquipmentPhotos equipmentId={equipmentId} />}

          {tab === 'errors' && (
            <EquipmentPlaceholder label="Ошибки и диагностика (ECU)" hint="ждёт датчик" />
          )}
        </div>

        {editDialog}
      </div>
    );
  }

  return (
    <div className={cn('space-y-5', 'p-4 lg:p-6')}>
      <BackLink />

      {header}

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
          <Metric label="Бурение, м" value={formatFixed(details.stats30d.drillingMeters, 1)} />
          <Metric label="Простой" value={formatHours(details.stats30d.downtimeHours)} />
        </div>
      </Section>

      {/* Full work history */}
      <Section icon={History} title="История работ">
        {details.timeline.length > 0 ? (
          <HistoryTable rows={details.timeline} />
        ) : (
          <EmptyState message="Отчётов по этой установке пока нет." />
        )}
      </Section>

      {/* Отчёт за период (печать / PDF) */}
      <Section icon={Printer} title="Отчёт (печать / PDF)">
        <EquipmentReportExport equipmentId={equipmentId} />
      </Section>

      {/* Мониторинг (телеметрия) */}
      <Section icon={Gauge} title="Мониторинг" collapsible defaultOpen={false}>
        <EquipmentMonitoring equipmentId={equipmentId} />
      </Section>

      {/* Обслуживание (ТО) */}
      <Section icon={Timer} title="Обслуживание">
        <MaintenanceBlock eq={eq} />
        <EquipmentMaintenance equipmentId={equipmentId} />
      </Section>

      {/* Осмотры */}
      <Section icon={ClipboardList} title="Осмотры">
        <EquipmentInspections equipmentId={equipmentId} />
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

      {/* Фото */}
      <Section icon={Camera} title="Фото">
        <EquipmentPhotos equipmentId={equipmentId} />
      </Section>

      {/* Документы */}
      <Section icon={FileText} title="Документы">
        <EquipmentDocuments
          equipmentId={equipmentId}
          documents={details.documents}
          onChanged={refresh}
        />
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
