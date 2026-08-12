'use client';

import { useEffect, useState } from 'react';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { KpiTile, type KpiTone } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { readinessFilterQuery, type ReadinessUrlFilters } from '../api/client';
import { type PresentationStage } from '../authoritative-presentation';

export const muted = 'text-muted-foreground';

export async function downloadReadinessExport(dataset: 'fleet' | 'permits' | 'reports' | 'dictionary' | 'audit', filters: ReadinessUrlFilters) {
  const query = readinessFilterQuery(filters);
  const response = await authFetch(`/api/readiness/export?dataset=${dataset}${query ? `&${query}` : ''}`);
  if (!response.ok) throw new Error(response.status === 403 ? 'Недостаточно прав для экспорта' : 'Не удалось сформировать экспорт');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
    ?? `pilingtrack-readiness-${dataset}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReadinessFiltersBar({filters, onChange, mode}: {
  filters: ReadinessUrlFilters;
  onChange: (next: ReadinessUrlFilters) => void;
  mode: 'shifts' | 'permits' | 'reports' | 'audit';
}) {
  const keys: Array<keyof ReadinessUrlFilters> = mode === 'shifts'
    ? ['status', 'from', 'to', 'shiftType']
    : mode === 'permits' ? ['status', 'from', 'to', 'risk']
      : mode === 'audit' ? ['from', 'to', 'eventType', 'actor'] : ['status', 'from', 'to'];
  const activeCount = keys.filter((key) => Boolean(filters[key])).length;
  const update = (key: keyof ReadinessUrlFilters, value: string) => onChange({...filters, [key]: value || undefined});
  return (
    <div aria-label="Фильтры" className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <label className="grid gap-1 text-2xs text-muted-foreground">С даты<Input aria-label="С даты" type="date" value={filters.from ?? ''} onChange={(event) => update('from', event.target.value)} className="h-9 w-[150px]" /></label>
      <label className="grid gap-1 text-2xs text-muted-foreground">По дату<Input aria-label="По дату" type="date" value={filters.to ?? ''} onChange={(event) => update('to', event.target.value)} className="h-9 w-[150px]" /></label>
      {(mode === 'shifts' || mode === 'permits' || mode === 'reports') && <label className="grid gap-1 text-2xs text-muted-foreground">Статус<select aria-label="Статус" value={filters.status ?? ''} onChange={(event) => update('status', event.target.value)} className="h-9 min-w-[150px] rounded-md border border-input bg-background px-3 text-xs text-foreground"><option value="">Все статусы</option>{mode === 'shifts' ? <><option value="PLANNED">Запланирована</option><option value="STARTED">В работе</option><option value="HANDOVER_PENDING">Передача</option><option value="CLOSED">Закрыта</option><option value="CANCELLED">Отменена</option></> : mode === 'permits' ? <><option value="DRAFT">Черновик</option><option value="PENDING_APPROVAL">На согласовании</option><option value="APPROVED">Согласован</option><option value="EXPIRED">Истёк</option><option value="REVOKED">Отозван</option></> : <><option value="READY">Готово</option><option value="ATTENTION">Требует внимания</option><option value="BLOCKED">Заблокировано</option></>}</select></label>}
      {mode === 'shifts' && <label className="grid gap-1 text-2xs text-muted-foreground">Тип смены<select aria-label="Тип смены" value={filters.shiftType ?? ''} onChange={(event) => update('shiftType', event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-xs"><option value="">Все</option><option value="DAY">Дневная</option><option value="NIGHT">Ночная</option></select></label>}
      {mode === 'permits' && <label className="grid gap-1 text-2xs text-muted-foreground">Риск<select aria-label="Риск" value={filters.risk ?? ''} onChange={(event) => update('risk', event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-xs"><option value="">Все</option><option value="NORMAL">Обычный</option><option value="ELEVATED">Повышенный</option></select></label>}
      {mode === 'audit' && <><label className="grid gap-1 text-2xs text-muted-foreground">Тип события<Input aria-label="Тип события" value={filters.eventType ?? ''} onChange={(event) => update('eventType', event.target.value)} className="h-9 w-[170px]" /></label><label className="grid gap-1 text-2xs text-muted-foreground">Актор<Input aria-label="Актор" value={filters.actor ?? ''} onChange={(event) => update('actor', event.target.value)} className="h-9 w-[170px]" /></label></>}
      <span className="inline-flex h-9 items-center rounded-md bg-muted px-3 text-xs font-semibold">Фильтров: {activeCount}</span>
      <Button type="button" variant="outline" className="h-9" disabled={activeCount === 0} onClick={() => onChange(Object.fromEntries(Object.entries(filters).filter(([key]) => !keys.includes(key as keyof ReadinessUrlFilters))))}>Сбросить</Button>
    </div>
  );
}

function EmptyPhoto({ className }: { className?: string }) {
  return (
    <div className={cn('grid place-items-center rounded bg-muted', className)}>
      <PilingIcon name="equipment-rig" decorative fill className="h-full w-full opacity-65" />
    </div>
  );
}

const resolvedEquipmentPhotoCache = new Map<string, string>();

const pendingEquipmentPhotoRequests = new Map<string, Promise<string | null>>();

function resolveProtectedEquipmentPhoto(photoUrl: string) {
  const cached = resolvedEquipmentPhotoCache.get(photoUrl);
  if (cached) return Promise.resolve(cached);

  const pending = pendingEquipmentPhotoRequests.get(photoUrl);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await authFetch(photoUrl);
      if (!response.ok) return null;
      const payload = await response.json() as { url?: unknown };
      if (typeof payload.url !== 'string') return null;
      resolvedEquipmentPhotoCache.set(photoUrl, payload.url);
      return payload.url;
    } catch {
      return null;
    } finally {
      pendingEquipmentPhotoRequests.delete(photoUrl);
    }
  })();

  pendingEquipmentPhotoRequests.set(photoUrl, request);
  return request;
}

function useResolvedEquipmentPhoto(photoUrl: string | null | undefined) {
  const [resolvedPhoto, setResolvedPhoto] = useState<{ source: string; url: string } | null>(() => {
    if (!photoUrl) return null;
    const cached = resolvedEquipmentPhotoCache.get(photoUrl);
    return cached ? { source: photoUrl, url: cached } : null;
  });

  useEffect(() => {
    if (!photoUrl?.startsWith('/api/')) return;

    const cached = resolvedEquipmentPhotoCache.get(photoUrl);
    if (cached) return;

    let active = true;
    void resolveProtectedEquipmentPhoto(photoUrl).then((url) => {
      if (active && url) {
        setResolvedPhoto({ source: photoUrl, url });
      }
    });

    return () => {
      active = false;
    };
  }, [photoUrl]);

  if (!photoUrl) return null;
  if (!photoUrl.startsWith('/api/')) return photoUrl;
  return resolvedEquipmentPhotoCache.get(photoUrl)
    ?? (resolvedPhoto?.source === photoUrl ? resolvedPhoto.url : null);
}

export function EquipmentPhoto({
  cardData,
  name,
  className,
  priority = false,
}: {
  cardData?: FleetCard;
  name: string;
  className: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const modelPhoto = getEquipmentPhoto(cardData?.model);
  const photoUrl = useResolvedEquipmentPhoto(cardData?.photoUrl ?? modelPhoto);
  if (!photoUrl || failed) return <EmptyPhoto className={className} />;
  return (
    <div className={cn('relative overflow-hidden rounded bg-muted', className)}>
      {/* Signed equipment media is resolved before rendering; model photos are only a fallback. */}
      { }
      <img
        src={photoUrl}
        alt={name}
        className="h-full w-full object-cover"
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export function ProcessRoleStrip({
  ariaLabel,
  roles,
}: {
  ariaLabel: string;
  roles: Array<{
    label: string;
    icon: PilingIconName;
    tasks: string[];
    tone: 'green' | 'blue' | 'orange';
  }>;
}) {
  const tones = {
    green: 'border-success/25 bg-success/10 text-success-strong',
    blue: 'border-info/25 bg-info/10 text-info-strong',
    orange: 'border-signal/25 bg-signal/10 text-signal-strong',
  } as const;

  return (
    <section aria-label={ariaLabel} className="mt-2 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 2xl:flex 2xl:gap-0">
      {roles.map((role, index) => (
        <div key={role.label} className="contents">
          {index > 0 && <div aria-hidden className="hidden w-7 shrink-0 items-center justify-center text-xl text-muted-foreground 2xl:flex">→</div>}
          <article className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card shadow-sm">
            <header className={cn('flex items-center gap-2 border-b px-3.5 py-2', tones[role.tone])}>
              <PilingIcon name={role.icon} decorative className="h-4 w-4" />
              <h2 className="text-sm font-extrabold">{role.label}</h2>
            </header>
            <div className="flex min-h-[52px] items-center gap-3 px-3 py-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-2xs leading-[1.35] text-muted-foreground">
                {role.tasks.map((task, taskIndex) => <span key={task} className="whitespace-nowrap">{taskIndex > 0 && <span className="mr-3 text-muted-foreground">•</span>}{task}</span>)}
              </div>
            </div>
          </article>
        </div>
      ))}
    </section>
  );
}

export function ReadinessRing({ value, size = 116 }: { value: number | null; size?: number }) {
  const numeric = value ?? 0;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 112 112" className="-rotate-90">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke={numeric >= 85 ? 'var(--success)' : 'var(--signal)'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - numeric / 100)}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-2xl font-extrabold leading-none text-foreground">{value ?? '—'}</div>
          <div className="mt-1 text-xs text-muted-foreground">/100</div>
        </div>
      </div>
    </div>
  );
}

export function RefKpi({
  icon,
  label,
  value,
  detail,
  alert,
  tone,
  onClick,
}: {
  icon: PilingIconName;
  label: string;
  value: React.ReactNode;
  detail?: string;
  alert?: boolean;
  tone?: KpiTone;
  onClick?: () => void;
}) {
  return <KpiTile icon={icon} label={label} value={value} detail={detail} alert={alert} tone={tone} onClick={onClick} />;
}

/** Подпись кнопки «следующее действие» — по конкретному незакрытому шагу. */
export const STAGE_CTA: Record<PresentationStage['key'], string> = {
  INSPECTION: 'Перейти к осмотру',
  ENGINE_HOURS: 'Внести моточасы',
  PERMIT: 'Открыть наряд-допуск',
  MAINTENANCE: 'Открыть обслуживание',
  ACCEPTANCE: 'Открыть приёмку',
};

/** Русский текст отказа команды: код статуса читателю ничего не говорит. */
export async function commandFailure(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as {error?: {message?: string} | string} | null;
  const serverMessage = typeof body?.error === 'string' ? body.error : body?.error?.message;
  if (response.status === 409) return 'Кто-то уже изменил эту запись. Данные обновлены — повторите действие с актуальной версией.';
  if (response.status === 422) return serverMessage || 'Условие операции не выполнено. Проверьте готовность, наряд и обязательные поля.';
  return serverMessage || 'Операция не выполнена. Повторите попытку.';
}
