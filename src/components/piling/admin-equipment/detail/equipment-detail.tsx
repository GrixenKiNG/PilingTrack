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
import {
  Section, KV, Metric, EmptyState, BackLink, TelematicsStatusBadge,
  HistoryTable, MaintenanceBlock, PassportGrid,
  formatNumber, formatHours, formatRelative,
  type TimelineRow,
} from './equipment-detail-parts';
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

