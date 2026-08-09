'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookText,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileBarChart,
  FileText,
  Gauge,
  HardHat,
  History,
  Link2,
  Lock,
  Search,
  Settings2,
  ShieldCheck,
  User,
  Users,
  WifiOff,
  Wrench,
} from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import {
  COMPACT_KPI_GRID,
  InfoRow,
  ScreenTitle,
  Toggle,
  card,
} from './readiness/settings/shared-ui';
import { ChecklistsSettings } from './readiness/settings/checklists-section';
import { RolesSettings } from './readiness/settings/roles-section';
import { DictionariesSettings } from './readiness/settings/dictionaries-section';
import { NotificationsSettings } from './readiness/settings/notifications-section';
import { IntegrationsSettings } from './readiness/settings/integrations-section';
import { AuditSettings } from './readiness/settings/audit-section';
import { auditActionLabel, auditEntityLabel } from './readiness/settings/audit-labels';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { formatDateInTimezone, formatDateTimeInTimezone, getTodayInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import {
  PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL,
  type MaintenancePriority, type MaintenanceStatus, type MaintenanceType,
} from '@/components/piling/maintenance/maintenance-labels';
import { PERMIT_STATE_LABEL, SHIFT_STATE_LABEL } from './readiness/readiness-labels';
import { buildHandoverJournal, handoverRoleLabel } from './readiness/handover-journal';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import {
  BLOCKER_ACTIONS,
  BLOCKER_ACTION_LABELS,
  BLOCKER_LABELS,
  CRITERION_LABELS,
  computeReadinessScore,
  describeRuleSetChanges,
  normalizeWeights,
  type BlockerAction,
  type ReadinessCriterionKey,
  type ReadinessFacts,
  type ReadinessRuleSet,
  type ReadinessRulesState,
  type ReadinessScoreResult,
} from '@/modules/readiness';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
import type { EquipmentReadiness, ReadinessStatus } from './readiness-model';
import type { CrewSummary, MaintenanceSummary } from './readiness-design-views';
import type {
  CurrentReadinessDto,
  ReadinessAuditEnvelope,
  ReadinessBootstrap,
  ReadinessShiftDto,
  ReadinessSnapshotDto,
  WorkPermitDto,
} from './readiness/api/contracts';
import { readinessFilterQuery, type ReadinessUrlFilters } from './readiness/api/client';
import {
  buildAuthoritativeReadinessPresentation,
  buildUnavailableReadinessPresentation,
  type PresentationStage,
} from './readiness/authoritative-presentation';
import { CommandDialog } from './readiness/shared/command-dialog';

export type ReferenceView =
  | 'readiness'
  | 'fleet'
  | 'shifts'
  | 'permits'
  | 'maintenance'
  | 'reports'
  | 'settings';

export type SettingsSection =
  | 'rules'
  | 'checklists'
  | 'roles'
  | 'dictionaries'
  | 'notifications'
  | 'integrations'
  | 'audit';

export interface EquipmentDetailSnapshot {
  equipment?: {
    id: string;
    name: string;
    serialNumber?: string | null;
    inventoryNumber?: string | null;
    engineHoursTotal?: number | null;
    nextMaintenanceAtHours?: number | null;
    nextMaintenanceDate?: string | null;
  };
  crew?: {
    id: string;
    name: string;
    operator?: { id: string; name: string } | null;
    site?: { id: string; name: string } | null;
  } | null;
  telematicsDevices?: Array<{
    id: string;
    label: string;
    provider: string;
    status: string;
    lastSeenAt: string | null;
  }>;
  documents?: Array<{ id: string; title?: string; name?: string; expiresAt?: string | null }>;
}

interface ReferenceUiProps {
  view: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  settingsSection: SettingsSection;
  onSettingsSectionChange: (section: SettingsSection) => void;
  equipment: EquipmentOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  readinessByEquipment: Record<string, EquipmentReadiness>;
  factsByEquipment: Record<string, ReadinessFacts>;
  scoresByEquipment: Record<string, ReadinessScoreResult>;
  rulesState: ReadinessRulesState;
  onRulesStateChange: (state: ReadinessRulesState) => void;
  journals: Record<string, JournalRecord[]>;
  crews: CrewSummary[];
  maintenance: MaintenanceSummary[];
  fleetCards: FleetCard[];
  details: Record<string, EquipmentDetailSnapshot>;
  loading: boolean;
  workspaceError: string | null;
  workspaceIssues: Array<{ source: string; message: string }>;
  rulesAvailable: boolean;
  bootstrap: ReadinessBootstrap | null;
  shifts: ReadinessShiftDto[];
  permits: WorkPermitDto[];
  currentReadiness: CurrentReadinessDto[];
  authoritativeReadinessError: string | null;
  readinessHistory: ReadinessSnapshotDto[];
  audit: ReadinessAuditEnvelope | null;
  filters: ReadinessUrlFilters;
  onFiltersChange: (filters: ReadinessUrlFilters) => void;
  showInternalNavigation: boolean;
  onRetry: () => void;
}

const VIEW_ITEMS: Array<{
  id: ReferenceView;
  label: string;
  icon: typeof ShieldCheck;
}> = [
  { id: 'readiness', label: 'Центр готовности', icon: ShieldCheck },
  { id: 'fleet', label: 'Техника', icon: HardHat },
  { id: 'shifts', label: 'Смены', icon: CalendarClock },
  { id: 'permits', label: 'Наряд-допуски', icon: FileText },
  { id: 'maintenance', label: 'Обслуживание', icon: Wrench },
  { id: 'reports', label: 'Отчёты', icon: BarChart3 },
  { id: 'settings', label: 'Настройки', icon: Settings2 },
];

const SETTINGS_ITEMS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof ShieldCheck;
}> = [
  { id: 'rules', label: 'Правила готовности', icon: ClipboardCheck },
  { id: 'checklists', label: 'Чек-листы', icon: FileText },
  { id: 'roles', label: 'Роли и доступы', icon: Users },
  { id: 'dictionaries', label: 'Справочники', icon: BookText },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'integrations', label: 'Интеграции', icon: Link2 },
  { id: 'audit', label: 'Аудит', icon: FileBarChart },
];

const STATUS_META: Record<ReadinessStatus, { label: string; tone: string }> = {
  READY: { label: 'Готово к работе', tone: 'green' },
  ATTENTION: { label: 'Требует внимания', tone: 'orange' },
  NO_DATA: { label: 'Нет данных', tone: 'orange' },
  IN_REPAIR: { label: 'В ремонте', tone: 'red' },
  BLOCKED: { label: 'Недоступно', tone: 'red' },
  OVERDUE: { label: 'ТО просрочено', tone: 'red' },
};

const muted = 'text-muted-foreground';

async function downloadReadinessExport(dataset: 'fleet' | 'permits' | 'reports' | 'dictionary' | 'audit', filters: ReadinessUrlFilters) {
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

function downloadCsv(filename: string, _rows: Array<Array<string | number | null | undefined>>) {
  const dataset = filename.includes('audit') ? 'audit'
    : filename.includes('dictionary') ? 'dictionary'
      : filename.includes('permit') ? 'permits'
        : filename.includes('report') ? 'reports' : 'fleet';
  const params = new URLSearchParams(window.location.search);
  const filters: ReadinessUrlFilters = {};
  for (const key of ['status', 'from', 'to', 'shiftType', 'risk', 'eventType', 'actor'] as const) {
    const value = params.get(key);
    if (value) (filters as Record<string, string>)[key] = value;
  }
  void downloadReadinessExport(dataset, filters)
    .catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'));
}

async function commandFailure(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as {error?: {message?: string} | string} | null;
  const serverMessage = typeof body?.error === 'string' ? body.error : body?.error?.message;
  if (response.status === 409) return 'Кто-то уже изменил эту запись. Данные обновлены — повторите действие с актуальной версией.';
  if (response.status === 422) return serverMessage || 'Условие операции не выполнено. Проверьте готовность, наряд и обязательные поля.';
  return serverMessage || 'Операция не выполнена. Повторите попытку.';
}

function formatTimeInTimezone(value: Date | string, timezone: string) {
  return formatDateInTimezone(value, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function decimalHourInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour + minute / 60;
}

function ReadinessFiltersBar({filters, onChange, mode}: {
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
    <div aria-label="Фильтры" className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <label className="grid gap-1 text-2xs text-muted-foreground">С даты<Input aria-label="С даты" type="date" value={filters.from ?? ''} onChange={(event) => update('from', event.target.value)} className="h-9 w-[150px]" /></label>
      <label className="grid gap-1 text-2xs text-muted-foreground">По дату<Input aria-label="По дату" type="date" value={filters.to ?? ''} onChange={(event) => update('to', event.target.value)} className="h-9 w-[150px]" /></label>
      {(mode === 'shifts' || mode === 'permits' || mode === 'reports') && <label className="grid gap-1 text-2xs text-muted-foreground">Статус<select aria-label="Статус" value={filters.status ?? ''} onChange={(event) => update('status', event.target.value)} className="h-9 min-w-[150px] rounded-md border border-input bg-background px-3 text-xs text-foreground"><option value="">Все статусы</option>{mode === 'shifts' ? <><option value="PLANNED">Запланирована</option><option value="STARTED">В работе</option><option value="HANDOVER_PENDING">Передача</option><option value="CLOSED">Закрыта</option><option value="CANCELLED">Отменена</option></> : mode === 'permits' ? <><option value="DRAFT">Черновик</option><option value="PENDING_APPROVAL">На согласовании</option><option value="APPROVED">Согласован</option><option value="EXPIRED">Истёк</option><option value="REVOKED">Отозван</option></> : <><option value="READY">Готово</option><option value="ATTENTION">Требует внимания</option><option value="BLOCKED">Заблокировано</option></>}</select></label>}
      {mode === 'shifts' && <label className="grid gap-1 text-2xs text-muted-foreground">Тип смены<select aria-label="Тип смены" value={filters.shiftType ?? ''} onChange={(event) => update('shiftType', event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-xs"><option value="">Все</option><option value="DAY">Дневная</option><option value="NIGHT">Ночная</option></select></label>}
      {mode === 'permits' && <label className="grid gap-1 text-2xs text-muted-foreground">Риск<select aria-label="Риск" value={filters.risk ?? ''} onChange={(event) => update('risk', event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-xs"><option value="">Все</option><option value="NORMAL">Обычный</option><option value="ELEVATED">Повышенный</option></select></label>}
      {mode === 'audit' && <><label className="grid gap-1 text-2xs text-muted-foreground">Тип события<Input aria-label="Тип события" value={filters.eventType ?? ''} onChange={(event) => update('eventType', event.target.value)} className="h-9 w-[170px]" /></label><label className="grid gap-1 text-2xs text-muted-foreground">Актор<Input aria-label="Актор" value={filters.actor ?? ''} onChange={(event) => update('actor', event.target.value)} className="h-9 w-[170px]" /></label></>}
      <span className="inline-flex h-9 items-center rounded-md bg-slate-100 px-3 text-xs font-semibold">Фильтров: {activeCount}</span>
      <Button type="button" variant="outline" className="h-9" disabled={activeCount === 0} onClick={() => onChange(Object.fromEntries(Object.entries(filters).filter(([key]) => !keys.includes(key as keyof ReadinessUrlFilters))))}>Сбросить</Button>
    </div>
  );
}

function StatusPill({ status }: { status: ReadinessStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold',
        meta.tone === 'green' && 'bg-success/10 text-success-strong',
        meta.tone === 'orange' && 'bg-signal/10 text-signal-strong',
        meta.tone === 'red' && 'bg-destructive/10 text-destructive-strong',
      )}
    >
      {meta.tone === 'green' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {meta.label}
    </span>
  );
}

function EmptyPhoto({ className }: { className?: string }) {
  return (
    <div className={cn('grid place-items-center rounded bg-slate-100', className)}>
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

function EquipmentPhoto({
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
    <div className={cn('relative overflow-hidden rounded bg-slate-100', className)}>
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

const ROLE_FLOW = [
  {
    label: 'Оператор',
    icon: 'inspection' as const,
    lucide: User,
    tasks: ['Провести осмотр', 'Зафиксировать моточасы', 'Передать диспетчеру'],
    state: 'В работе',
    progress: '1/5 шагов',
    border: 'border-success/25',
    header: 'border-success/25 bg-success/10 text-success-strong',
  },
  {
    label: 'Диспетчер',
    icon: 'dispatcher' as const,
    lucide: User,
    tasks: ['Проверить готовность', 'Принять и назначить технику', 'Открыть смену'],
    state: 'Ожидает',
    progress: '0/3 шагов',
    border: 'border-info/25',
    header: 'border-info/25 bg-info/10 text-info-strong',
  },
  {
    label: 'Механик',
    icon: 'repair' as const,
    lucide: Wrench,
    tasks: ['Устранить дефекты', 'Провести обслуживание', 'Подтвердить работы'],
    state: 'Ожидает',
    progress: '0/3 шагов',
    border: 'border-signal/25',
    header: 'border-signal/25 bg-signal/10 text-signal-strong',
  },
  {
    label: 'Администратор',
    icon: 'reports' as const,
    lucide: ShieldCheck,
    tasks: ['Контролировать допуски', 'Настроить правила и чек-листы', 'Анализировать показатели'],
    border: 'border-border',
    header: 'border-border bg-muted text-foreground',
  },
];

function RoleFlowFooter() {
  return (
    <section aria-label="Роли процесса технической готовности" className="mt-2 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 2xl:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] 2xl:gap-0">
      {ROLE_FLOW.map((role, index) => {
        const RoleIcon = role.lucide;
        return (
          <div key={role.label} className="contents">
            <article className={cn('flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm', role.border)}>
              <header className={cn('flex items-center gap-2 border-b px-3 py-1.5', role.header)}>
                <RoleIcon className="h-4 w-4" />
                <h2 className="text-sm font-extrabold">{role.label}</h2>
              </header>
              <div className="flex flex-1 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-1 text-2xs leading-[1.35] text-muted-foreground">
                  {role.tasks.map((task) => <div key={task} className="flex gap-1.5"><span className="text-muted-foreground">•</span><span>{task}</span></div>)}
                </div>
                {role.state && (
                  <div className="shrink-0 rounded-[10px] border border-border px-2.5 py-1.5 text-center text-2xs">
                    <div className="text-muted-foreground">{role.state}</div>
                    <div className="font-bold">{role.progress}</div>
                  </div>
                )}
                {/* The handoff uses the approved PNG directly in this footer. */}
                { }
                <img src={`/icons/pilingtrack/${role.icon}.png`} alt="" className="h-[34px] w-[34px] shrink-0 object-contain" />
              </div>
            </article>
            {index < ROLE_FLOW.length - 1 && <div className="hidden items-center justify-center text-xl text-muted-foreground 2xl:flex">→</div>}
          </div>
        );
      })}
    </section>
  );
}

function ProcessRoleStrip({
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
          <article className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-white shadow-sm">
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

function EvidenceState({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'rounded px-2 py-1 text-xs font-semibold',
        state === 'pass' && 'bg-success/10 text-success-strong',
        state === 'warning' && 'bg-signal/10 text-signal-strong',
        state === 'missing' && 'bg-muted text-muted-foreground',
        state === 'block' && 'bg-destructive/10 text-destructive-strong',
      )}
    >
      {state === 'pass' ? 'Выполнено' : state === 'block' ? 'Есть' : state === 'warning' ? 'С замечаниями' : 'Не подтверждено'}
    </span>
  );
}

function ReadinessRing({ value, size = 116 }: { value: number | null; size?: number }) {
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

function RefKpi({
  icon,
  label,
  value,
  detail,
  alert,
  onClick,
}: {
  icon: PilingIconName;
  label: string;
  value: React.ReactNode;
  detail?: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  return <KpiTile icon={icon} label={label} value={value} detail={detail} alert={alert} onClick={onClick} />;
}

export function ReadinessReferenceUi(props: ReferenceUiProps) {
  const initialLoading = props.loading && props.equipment.length === 0;
  const fatalError = Boolean(props.workspaceError && props.equipment.length === 0);

  return (
    <div
      aria-busy={props.loading}
      className="tech-readiness-module min-h-screen w-full min-w-0 overflow-x-hidden overflow-y-auto bg-background font-sans text-foreground"
    >
      <div className="min-h-screen w-full min-w-0">
        {props.showInternalNavigation && <header
          aria-label="Разделы модуля технической готовности"
          className="sticky top-0 z-20 flex h-12 w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden bg-primary px-2 text-white sm:px-4"
        >
          {VIEW_ITEMS.filter((item) => props.bootstrap?.capabilities.screens[item.id] !== false).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={props.view === item.id}
                onClick={() => props.onViewChange(item.id)}
                className={cn(
                  'relative inline-flex h-full shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 hover:text-white',
                  props.view === item.id && 'text-white after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-signal-strong',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </header>}
        {props.workspaceIssues.length > 0 && !fatalError && (
          <div
            role="status"
            className="mx-2 mt-3 flex flex-col gap-3 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm sm:mx-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold text-signal-strong">Часть данных временно недоступна</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {props.workspaceIssues.map((issue) => (
                  <li key={issue.source} className="break-words">
                    <span className="font-semibold text-foreground">{issue.source}:</span>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={props.loading}
              onClick={props.onRetry}
              className="shrink-0"
            >
              {props.loading ? 'Повторная загрузка…' : 'Повторить'}
            </Button>
          </div>
        )}
        {initialLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="grid min-h-[420px] place-items-center px-4 text-center"
          >
            <div>
              <div className="mx-auto h-10 w-10 animate-pulse rounded-full border-4 border-signal/25 border-t-signal" />
              <p className="mt-4 font-semibold">Загружаем центр технической готовности</p>
              <p className="mt-1 text-sm text-muted-foreground">Получаем установки, журналы и данные обслуживания.</p>
            </div>
          </div>
        ) : fatalError ? (
          <div className="grid min-h-[420px] place-items-center px-4">
            <section
              role="alert"
              className="w-full max-w-lg rounded-[14px] border border-destructive/30 bg-white p-6 text-center shadow-sm"
            >
              <WifiOff className="mx-auto h-9 w-9 text-destructive-strong" />
              <h1 className="mt-3 text-lg font-bold">Центр готовности не загрузился</h1>
              <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
                {props.workspaceError}
              </p>
              <Button
                type="button"
                disabled={props.loading}
                onClick={props.onRetry}
                className="mt-5 bg-signal-strong hover:bg-signal-strong"
              >
                {props.loading ? 'Повторная загрузка…' : 'Повторить загрузку'}
              </Button>
            </section>
          </div>
        ) : props.view === 'settings' ? (
          <SettingsWorkspace {...props} />
        ) : (
          <main className="min-w-0 px-2 sm:px-4">
            {(props.view === 'shifts' || props.view === 'permits' || props.view === 'reports') && (
              <ReadinessFiltersBar filters={props.filters} onChange={props.onFiltersChange} mode={props.view} />
            )}
            {props.view === 'readiness' && <ReadinessCentre {...props} />}
            {props.view === 'fleet' && <FleetScreen {...props} />}
            {props.view === 'shifts' && <ShiftsScreen {...props} />}
            {props.view === 'permits' && <PermitsScreen {...props} />}
            {props.view === 'maintenance' && <MaintenanceScreen {...props} />}
            {props.view === 'reports' && <ReportsScreen {...props} />}
          </main>
        )}
      </div>
    </div>
  );
}

/** Этап цепочки: ведёт либо на страницу другого модуля, либо на вкладку контура. */
function StageLink({target, label, onViewChange, children}: {
  target: {href?: string; view?: ReferenceView};
  label: string;
  onViewChange: (view: ReferenceView) => void;
  children: React.ReactNode;
}) {
  const shared = 'block min-h-11 rounded-lg px-2 py-1 text-center transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return target.href
    ? <Link href={target.href} className={shared} aria-label={`${label}: открыть`}>{children}</Link>
    : <button type="button" onClick={() => target.view && onViewChange(target.view)} className={shared} aria-label={`${label}: открыть`}>{children}</button>;
}

function ReadinessCentre(props: ReferenceUiProps) {
  const selected = props.equipment.find((item) => item.id === props.selectedId) ?? props.equipment[0];
  if (!selected) {
    return (
      <div className="grid min-h-[420px] place-items-center px-4 text-center">
        <div className="max-w-md">
          <HardHat className="mx-auto h-9 w-9 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-bold">Установки не найдены</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Добавьте установку в модуле «Оборудование» или повторите загрузку, если данные появились недавно.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline"><Link href="/admin/equipment">Открыть оборудование</Link></Button>
            <Button type="button" onClick={props.onRetry}>Повторить</Button>
          </div>
        </div>
      </div>
    );
  }
  const authoritativeCurrent = props.currentReadiness.find((item) => item.equipmentId === selected.id) ?? null;
  const presentation = props.authoritativeReadinessError
    ? buildUnavailableReadinessPresentation(authoritativeCurrent)
    : buildAuthoritativeReadinessPresentation(authoritativeCurrent);
  const detail = props.details[selected.id];
  const fleetCard = props.fleetCards.find((item) => item.id === selected.id);
  const handoverJournal = buildHandoverJournal(props.shifts, selected.id, props.bootstrap?.selectors.actors);
  const inspectionEvidenceId = presentation.evidence.find((item) => item.key === 'inspection')?.reference ?? null;
  /**
   * Куда ведёт шаг чек-листа. Осмотр и моточасы живут в других модулях,
   * остальные шаги — вкладки этого же контура. Раньше строки показывали
   * шеврон, но не открывали ничего.
   */
  const stageTargets: Record<PresentationStage['key'], {href?: string; view?: ReferenceView}> = {
    INSPECTION: {href: inspectionEvidenceId ? `/inspections/${inspectionEvidenceId}` : '/inspections'},
    ENGINE_HOURS: {href: `/admin/equipment/${selected.id}`},
    PERMIT: {view: 'permits'},
    MAINTENANCE: {view: 'maintenance'},
    ACCEPTANCE: {view: 'shifts'},
  };
  const blockers = presentation.blockers.length;
  const warnings = presentation.warnings.length;

  return (
    <div>
      <div className="grid min-h-0 grid-cols-1 gap-3 py-3 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
        <div className="border-b border-border p-4">
          <div className={cn(muted, 'text-2xs')}>Выбранная установка</div>
          <div className="mt-3 flex gap-3">
            <EquipmentPhoto cardData={fleetCard} name={selected.name} className="h-24 w-24 shrink-0" priority />
            <div className="min-w-0">
              <h2 className="break-words text-xl font-extrabold">
                <Link href={`/admin/equipment/${selected.id}`} className="hover:text-signal-strong hover:underline">{selected.name}</Link>
              </h2>
              <div className="mt-2 text-2xs text-muted-foreground">Заводской №</div>
              <div className="text-xs font-semibold">{detail?.equipment?.serialNumber || '—'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Место базирования</div>
              <div className="text-xs font-semibold">{detail?.crew?.site?.name
                ? <Link href="/admin/sites" className="hover:text-signal-strong hover:underline">{detail.crew.site.name}</Link>
                : 'Не назначено'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Наработка</div>
              <div className="text-xs font-semibold">{selected.engineHoursTotal != null ? `${selected.engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—'}</div>
            </div>
          </div>
        </div>
        <div className="border-b border-border p-4">
          <div className="text-2xs text-muted-foreground">Статус готовности</div>
          <div className="mt-2">
            <span className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold',
              presentation.status === 'READY' && 'bg-success/10 text-success-strong',
              presentation.status === 'BLOCKED' && 'bg-destructive/10 text-destructive-strong',
              presentation.status === 'UNCONFIRMED' && 'bg-signal/10 text-signal-strong',
            )}>
              {presentation.status === 'READY' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {presentation.status === 'READY' ? 'Готово' : presentation.status === 'BLOCKED' ? 'Заблокировано' : 'Не подтверждено'}
            </span>
          </div>
          <div className="mt-3 rounded-lg border border-signal bg-signal/10 p-3">
            <div className="text-2xs text-muted-foreground">Следующее действие</div>
            <div className="mt-2 font-bold">{presentation.nextAction}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.authoritativeReadinessError ?? presentation.description}</p>
            <Button asChild className="mt-3 h-10 w-full bg-signal-strong hover:bg-signal-strong">
              <Link href="/admin/to">
                Перейти к действию <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="p-4">
          <h3 className="font-bold">Чек-лист смены (5 шагов)</h3>
          <div className="mt-3 divide-y divide-border">
            {presentation.stages.map((stage, index) => {
              const target = stageTargets[stage.key];
              const body = (
                <>
                  <span className={cn('grid h-6 w-6 place-items-center rounded-full text-xs font-bold', stage.state === 'pass' ? 'bg-success-strong text-white' : stage.state === 'unknown' ? 'bg-muted text-muted-foreground' : 'bg-signal-strong text-white')}>{index + 1}</span>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-xs font-semibold">{stage.label}</div>
                    <div
                      title={stage.value}
                      className="line-clamp-2 break-words text-2xs text-muted-foreground"
                    >
                      {stage.value}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              );
              const shared = 'flex w-full min-h-11 items-center gap-3 py-2.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
              return target.href
                ? <Link key={stage.key} href={target.href} className={shared} aria-label={`${stage.label}: открыть`}>{body}</Link>
                : <button key={stage.key} type="button" onClick={() => target.view && props.onViewChange(target.view)} className={shared} aria-label={`${stage.label}: открыть`}>{body}</button>;
            })}
          </div>
        </div>
      </section>

      <div className="space-y-3">
        <section className={cn(card, 'p-5')}>
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <h2 className="font-bold">Готовность к работе (доказательная)</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-8">
                <ReadinessRing value={presentation.score} />
                <div>
                  <div className="text-xs text-muted-foreground">Итоговый балл готовности</div>
                  <div className="mt-1 font-mono text-2xl font-bold">{presentation.score ?? '—'} <span className="text-sm font-normal text-muted-foreground">/100</span></div>
                  <div className="mt-3 flex gap-4 text-xs">
                    <span>Критические блокеры <b className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive-strong">{blockers}</b></span>
                    <span>Замечания <b className="ml-1 rounded bg-signal/10 px-1.5 py-0.5 text-signal-strong">{warnings}</b></span>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-left text-xs text-muted-foreground sm:text-right">
              <div>Последнее обновление</div>
              <div className="mt-2 font-semibold text-muted-foreground">{presentation.calculatedAt ? formatDateTimeInTimezone(presentation.calculatedAt, props.bootstrap?.tenant.timezone) : 'Авторитетного снимка нет'}</div>
              <Button variant="outline" className="mt-3 h-9" onClick={() => props.onViewChange('reports')}><History className="mr-2 h-4 w-4" />История оценок</Button>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            {presentation.ruleSetVersion === 'unpublished'
              ? 'Правила готовности ещё не опубликованы. '
              : presentation.ruleSetVersion ? `Правила ${presentation.ruleSetVersion}. ` : ''}{presentation.title}. {presentation.calculatedAt ? `Авторитетный снимок от ${formatDateTimeInTimezone(presentation.calculatedAt, props.bootstrap?.tenant.timezone)}.` : presentation.description}
          </div>
        </section>
        <section className={cn(card, 'overflow-hidden')}>
          <div className="p-4">
            <h2 className="font-bold">Цепочка состояния</h2>
            <div className="mt-4 flex items-center justify-between overflow-x-auto pb-2">
              {presentation.stages.map((stage, index) => {
                const Icon = [Search, Gauge, ShieldCheck, Wrench, User][index] ?? Search;
                return (
                <div key={stage.key} className="flex min-w-[118px] flex-1 items-center">
                  <StageLink target={stageTargets[stage.key]} label={stage.label} onViewChange={props.onViewChange}>
                    <span className={cn('mx-auto grid h-10 w-10 place-items-center rounded-full border', stage.state === 'pass' ? 'border-success bg-success-strong text-white' : stage.state === 'unknown' ? 'border-border bg-muted text-muted-foreground' : 'border-signal bg-signal-strong text-white')}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className={cn('mt-2 text-2xs', stage.state === 'fail' ? 'font-semibold text-signal-strong' : 'text-muted-foreground')}>{stage.label}</div>
                  </StageLink>
                  {index < 4 && <div className="mx-3 h-px flex-1 bg-border" />}
                </div>
              );})}
            </div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="font-bold">Критическое замечание</h3>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3">
              <AlertTriangle className="h-7 w-7 text-destructive-strong" />
              <div className="flex-1">
                <div className="font-semibold">{presentation.blockers[0]?.label ?? (presentation.status === 'UNCONFIRMED' ? presentation.title : 'Критических замечаний не обнаружено')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{presentation.blockers[0]?.actionLabel ?? presentation.description}</div>
              </div>
              <span className="rounded border border-destructive px-2 py-1 text-xs text-destructive-strong">{blockers ? 'Критическое' : 'Нет блокеров'}</span>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="font-bold">Доказательства готовности</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-5">
              {presentation.evidence.map((evidence) => (
                <div key={evidence.key} className="rounded-lg border border-border p-3">
                  <div className="text-xs font-semibold">{evidence.label}</div>
                  <div className="mt-2 break-all text-2xs text-muted-foreground">{evidence.reference}</div>
                  {evidence.links && evidence.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {evidence.links.map((link) => (
                        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong hover:underline">
                          {link.text}<ArrowRight className="h-3 w-3" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {presentation.evidence.length === 0 && <div className="rounded-lg border border-signal/30 bg-signal/10 p-3 text-xs text-signal-strong">{presentation.title}</div>}
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-3 md:col-span-2 xl:col-span-1">
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача и приёмка</h2><span className="text-2xs text-muted-foreground">неизменяемый журнал</span></div>
          {handoverJournal.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border p-3 text-2xs leading-relaxed text-muted-foreground">
              По этой установке ещё не было передач смены. Записи появятся, когда оператор передаст смену диспетчеру.
            </p>
          ) : (
            <ol className="mt-4 space-y-5 border-l border-border pl-5">
              {handoverJournal.map((event, index) => (
                <li key={event.id} className="relative">
                  <span className={cn('absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full',
                    index === 0 ? 'bg-signal-strong' : event.kind === 'REWORKED' ? 'bg-warning-strong' : 'bg-muted-foreground')} />
                  <div className="text-xs font-semibold">{event.label}</div>
                  <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                    {formatDateTimeInTimezone(event.occurredAt, props.bootstrap?.tenant.timezone)}
                    {event.actorName ? ` · ${event.actorName}` : ''}
                    {handoverRoleLabel(event.actorRole) ? ` (${handoverRoleLabel(event.actorRole)})` : ''}
                    {` · пакет v${event.packageVersion}`}
                  </div>
                  {event.comment && (
                    <p className="mt-1 rounded border border-border bg-muted/40 p-2 text-2xs leading-relaxed">{event.comment}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={() => props.onViewChange('reports')} className="mt-4 text-xs font-semibold text-signal-strong">Открыть полный журнал →</button>
        </section>
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Входящие (диспетчер)</h2><span className="text-xs text-muted-foreground">{props.equipment.length}</span></div>
          <div className="mt-3 space-y-3">
            {props.equipment.slice(0, 3).map((item) => {
              const itemSnapshot = props.currentReadiness.find((entry) => entry.equipmentId === item.id) ?? null;
              const itemPresentation = props.authoritativeReadinessError
                ? buildUnavailableReadinessPresentation(itemSnapshot)
                : buildAuthoritativeReadinessPresentation(itemSnapshot);
              const itemFleet = props.fleetCards.find((cardItem) => cardItem.id === item.id);
              return (
                <button key={item.id} type="button" onClick={() => props.onSelect(item.id)} className="flex w-full gap-3 rounded-lg border border-border p-3 text-left hover:border-orange-300">
                  <EquipmentPhoto cardData={itemFleet} name={item.name} className="h-12 w-12 shrink-0" />
                  <div className="min-w-0"><div className="truncate text-xs font-bold">{item.name}</div><div className="mt-1 text-2xs text-muted-foreground">{props.details[item.id]?.crew?.site?.name || 'Объект не назначен'}</div><div className="mt-2 text-2xs font-semibold">{itemPresentation.status === 'READY' ? 'Готово' : itemPresentation.status === 'BLOCKED' ? 'Заблокировано' : 'Не подтверждено'}</div></div>
                </button>
              );
            })}
          </div>
        </section>
        </aside>
      </div>
      <RoleFlowFooter />
    </div>
  );
}

type FleetStatusFilter = 'all' | 'ready' | 'attention' | 'blocked';

/** Группа, в которую попадает установка по своему статусу готовности. */
function matchesFleetStatus(status: ReadinessStatus | undefined, filter: FleetStatusFilter): boolean {
  if (filter === 'all') return true;
  if (!status) return filter === 'attention';
  if (filter === 'ready') return status === 'READY';
  if (filter === 'attention') return status === 'ATTENTION' || status === 'NO_DATA';
  return status === 'IN_REPAIR' || status === 'BLOCKED' || status === 'OVERDUE';
}

function FleetScreen(props: ReferenceUiProps) {
  const readinessItems = Object.values(props.readinessByEquipment);
  const ready = readinessItems.filter((item) => item.status === 'READY').length;
  const attention = readinessItems.filter((item) => ['ATTENTION', 'NO_DATA'].includes(item.status)).length;
  const blocked = readinessItems.filter((item) => ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const averageReadiness = readinessItems.length > 0
    ? Math.round(readinessItems.reduce((sum, item) => sum + (item.score ?? 0), 0) / readinessItems.length)
    : 0;
  const working = props.fleetCards.filter((item) => item.equipmentStatus === 'working').length;
  const inMaintenance = props.fleetCards.filter((item) => item.equipmentStatus === 'repair').length;
  const withoutCrew = props.fleetCards.filter((item) => !item.assignedCrewName).length;
  const [query, setQuery] = useState('');
  // Плитки и левая панель раньше только показывали числа. Один фильтр на всех,
  // чтобы клик по «Недоступно» действительно сужал список.
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>('all');
  const filtered = props.equipment.filter((item) => {
    const matchesQuery = `${item.name} ${item.model ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && matchesFleetStatus(props.readinessByEquipment[item.id]?.status, statusFilter);
  });
  const selected = props.equipment.find((item) => item.id === props.selectedId) ?? props.equipment[0];
  const selectedReadiness = selected ? props.readinessByEquipment[selected.id] : null;
  const selectedFleet = selected ? props.fleetCards.find((item) => item.id === selected.id) : undefined;

  return (
    <>
      <ScreenTitle
        heading="Техника"
        subtitle="Готовность и состояние парка"
        actions={(
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/admin/equipment">+ Добавить технику</Link></Button>
            <Button variant="outline" onClick={() => void downloadReadinessExport('fleet', props.filters)
              .catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>↓ Экспорт</Button>
          </div>
        )}
      />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="equipment-rig" label="Всего" value={props.equipment.length} onClick={() => setStatusFilter('all')} />
        <RefKpi icon="accepted" label="Готово" value={ready} onClick={() => setStatusFilter('ready')} />
        <RefKpi icon="risk" label="Требует внимания" value={attention} alert={attention > 0} onClick={() => setStatusFilter('attention')} />
        <RefKpi icon="defect" label="Недоступно" value={blocked} alert={blocked > 0} onClick={() => setStatusFilter('blocked')} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[180px_minmax(0,1fr)_290px]">
        <aside className={cn(card, 'p-3')}>
          <h2 className="font-bold">Парк техники</h2>
          <div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск установки" className="h-9 bg-muted pl-9" /></div>
          <FilterGroup
            title="Статус готовности"
            active={statusFilter}
            onSelect={setStatusFilter}
            rows={[['all', 'Все установки', props.equipment.length], ['ready', 'Готово', ready], ['attention', 'Требует внимания', attention], ['blocked', 'Недоступно', blocked]]}
          />
          <FilterGroup title="Объект" rows={Array.from(new Set(props.fleetCards.map((item) => item.assignedSiteName || 'Без объекта'))).slice(0, 5).map((name) => [name, props.fleetCards.filter((item) => (item.assignedSiteName || 'Без объекта') === name).length])} />
          <FilterGroup title="Загрузка парка" rows={[['Высокая (≥75%)', ready], ['Средняя (35–74%)', attention], ['Низкая (<35%)', blocked]]} />
        </aside>
        <section>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Установки</h2><span className="text-xs text-muted-foreground">Сортировка: <b className="text-muted-foreground">По готовности</b></span></div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filtered.map((item) => {
              const state = props.readinessByEquipment[item.id];
              const fleet = props.fleetCards.find((entry) => entry.id === item.id);
              return (
                <button key={item.id} type="button" onClick={() => props.onSelect(item.id)} className={cn(card, 'flex min-h-[140px] gap-2 p-2 text-left transition hover:border-orange-300', item.id === props.selectedId && 'border-signal')}>
                  <EquipmentPhoto cardData={fleet} name={item.name} className="h-[72px] w-[72px] shrink-0 self-center" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between"><div><h3 className="font-bold">{item.name}</h3><div className="mt-1 text-xs text-muted-foreground">{fleet?.assignedSiteName || 'Объект не назначен'}</div></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
                    <div className="mt-1 flex items-center gap-2"><ReadinessRing value={state?.score ?? null} size={40} />{state && <StatusPill status={state.status} />}</div>
                    <div className="mt-1 flex items-center gap-2 text-3xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        { }
                        <img src="/icons/pilingtrack/engine-hours.png" alt="" className="h-3.5 w-3.5 object-contain" />
                        {item.engineHoursTotal != null ? `${item.engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—'}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        { }
                        <img src="/icons/pilingtrack/crew.png" alt="" className="h-3.5 w-3.5 object-contain" />
                        <span className="truncate">{fleet?.assignedCrewName || 'Бригада не назначена'}</span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-1 text-3xs"><span className="shrink-0 text-muted-foreground">Следующее действие</span><span className="truncate font-semibold text-signal-strong">{state?.nextAction || 'Проверить данные'} ›</span></div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        <aside className={cn(card, 'self-start p-3 xl:sticky xl:top-14')}>
          {selected ? (
            <>
              <h2 className="text-lg font-bold">{selected.name}</h2>
              <div className="mt-3 flex gap-2">
                <EquipmentPhoto cardData={selectedFleet} name={selected.name} className="h-[88px] w-[80px] shrink-0" priority />
                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <InfoRow label="Заводской №" value={props.details[selected.id]?.equipment?.serialNumber || '—'} />
                  <InfoRow label="Площадка" value={selectedFleet?.assignedSiteName || '—'} />
                </div>
                <ReadinessRing value={selectedReadiness?.score ?? null} size={56} />
              </div>
              <div className="mt-3">{selectedReadiness && <StatusPill status={selectedReadiness.status} />}</div>
              <div className="mt-2 divide-y divide-border">{selectedReadiness?.evidence.map((evidence) => <div key={evidence.key} className="flex items-center justify-between py-2 text-2xs"><span className="font-semibold">{evidence.label}</span><EvidenceState state={evidence.state} /></div>)}</div>
              {selectedReadiness?.activeRecord && (
                <div className="mt-2 rounded-lg border border-destructive bg-destructive/10 p-2.5">
                  <div className="flex items-start gap-2">
                    { }
                    <img src="/icons/pilingtrack/defect.png" alt="" className="h-6 w-6 shrink-0 object-contain" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold"><Link href={`/admin/maintenance/${selectedReadiness.activeRecord.id}`} className="hover:underline">{selectedReadiness.activeRecord.title}</Link></div>
                      <span className="mt-1 inline-flex rounded border border-destructive px-1.5 py-0.5 text-3xs font-semibold text-destructive-strong">Критическое</span>
                      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{selectedReadiness.reason}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-2">
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground">Следующее действие</div>
                <div className="flex items-center gap-2.5 rounded-[10px] border border-border p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold">{selectedReadiness?.nextAction || 'Проверить данные готовности'}</div>
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{selectedReadiness?.reason || 'Откройте центр готовности для продолжения процесса.'}</p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-signal/10 text-signal-strong"><ClipboardCheck className="h-5 w-5" /></span>
                </div>
                <Button className="mt-2 h-9 w-full bg-signal-strong hover:bg-signal-strong" onClick={() => props.onViewChange('readiness')}>
                  Перейти к действию <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground">Выберите установку</div>}
        </aside>
      </div>
      <section className="mt-2 grid grid-cols-2 overflow-hidden rounded-lg shadow-sm md:grid-cols-4">
        <div className="border-r border-border bg-white p-3">
          <div className="text-xs text-muted-foreground">Готовность парка</div>
          <div className="mt-1 flex items-center gap-3">
            <ReadinessRing value={averageReadiness} size={48} />
            <div className="text-xs leading-relaxed text-muted-foreground">Средняя готовность<br /><b className="text-muted-foreground">{ready} из {props.equipment.length} установок</b></div>
          </div>
        </div>
        {[
          ['В работе', working, 'equipment-rig' as const],
          ['На обслуживании', inMaintenance, 'repair' as const],
          ['Без экипажа', withoutCrew, 'crew' as const],
        ].map(([label, value, icon], index) => (
          <div key={label} className={cn('bg-white p-3', index < 2 && 'md:border-r md:border-border')}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="font-mono text-xl font-bold tabular-nums text-slate-900">{value}</span>
              { }
              <img src={`/icons/pilingtrack/${icon}.png`} alt="" className="h-[34px] w-[34px] object-contain" />
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

function FilterGroup({ title: groupTitle, rows, active, onSelect }: {
  title: string;
  /** Без onSelect — просто сводка, с ним каждая строка выбирает фильтр. */
  rows: Array<readonly [string, number]> | Array<readonly [FleetStatusFilter, string, number]>;
  active?: FleetStatusFilter;
  onSelect?: (value: FleetStatusFilter) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold">{groupTitle}</h3>
      <div className="mt-2 space-y-1.5">
        {rows.map((row, index) => {
          const selectable = onSelect != null && row.length === 3;
          const [value, label, count] = row.length === 3
            ? row as readonly [FleetStatusFilter, string, number]
            : ['all' as FleetStatusFilter, ...(row as readonly [string, number])] as const;
          const isActive = selectable ? active === value : index === 0;
          const inner = (
            <>
              <span><span className={cn('mr-2 inline-block h-2 w-2 rounded-full border', isActive ? 'border-signal bg-signal-strong' : 'border-border')} />{label}</span>
              <b>{count}</b>
            </>
          );
          return selectable
            ? <button key={label} type="button" aria-pressed={isActive} onClick={() => onSelect?.(value)} className={cn('flex min-h-11 w-full items-center justify-between rounded px-1 text-left text-xs transition hover:bg-muted/60', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{inner}</button>
            : <div key={label} className="flex items-center justify-between text-xs text-muted-foreground">{inner}</div>;
        })}
      </div>
    </div>
  );
}

function ShiftsScreen(props: ReferenceUiProps) {
  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [command, setCommand] = useState<{shift: ReadinessShiftDto; action: 'request-acceptance' | 'start' | 'handover' | 'decline'} | null>(null);
  const [reworkTarget, setReworkTarget] = useState<ReadinessShiftDto['handovers'][number] | null>(null);
  const [reworkReason, setReworkReason] = useState('');
  const [commandSummary, setCommandSummary] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const activeCrews = props.crews.filter((crew) => crew.isActive);
  const timezone = props.bootstrap?.tenant.timezone ?? 'Europe/Moscow';
  const today = getTodayInTimezone(timezone);
  const weekStart = Date.now() - 6 * 86_400_000;
  const todayShifts = props.shifts.filter((shift) => period === 'day'
    ? shift.productionDate.slice(0, 10) === today
    : new Date(shift.productionDate).getTime() >= weekStart);
  const ready = todayShifts.filter((shift) => shift.state === 'STARTED');
  const waiting = todayShifts.filter((shift) => shift.state === 'HANDOVER_PENDING');
  const blocked = todayShifts.filter((shift) => shift.state === 'CANCELLED');
  const hours = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];
  const createShift = async () => {
    if (!props.selectedId || !props.bootstrap?.capabilities.entities.shift.manage) return;
    const hour = new Date().getHours();
    const response = await authFetch('/api/readiness/shifts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(props.bootstrap?.actor.actingAs === 'MECHANIC' ? { 'x-readiness-acting-as': 'MECHANIC' } : {}),
      },
      body: JSON.stringify({ equipmentId: props.selectedId, type: hour >= 20 || hour < 8 ? 'NIGHT' : 'DAY' }),
    });
    if (!response.ok) return toast.error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось создать смену');
    toast.success('Смена создана');
    props.onRetry();
  };
  const acceptHandover = async (handover: ReadinessShiftDto['handovers'][number]) => {
    const response = await authFetch(`/api/readiness/handovers/${handover.id}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"handover-${handover.id}-v${handover.version}"`,
      },
      body: JSON.stringify({ expectedVersion: handover.version }),
    });
    if (!response.ok) return toast.error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось принять смену');
    toast.success('Передача смены принята');
    props.onRetry();
  };
  /**
   * Возврат пакета оператору. Раньше интерфейс умел только принимать: endpoint
   * существовал, но не вызывался, и диспетчер не мог отказать в приёмке.
   */
  const reworkHandover = async (handover: ReadinessShiftDto['handovers'][number], reason: string) => {
    setCommandPending(true);
    setCommandError(null);
    const response = await authFetch(`/api/readiness/handovers/${handover.id}/rework`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"handover-${handover.id}-v${handover.version}"`,
      },
      body: JSON.stringify({ expectedVersion: handover.version, reason: reason.trim() }),
    });
    setCommandPending(false);
    if (!response.ok) {
      setCommandError((await response.json().catch(() => null))?.error?.message ?? 'Не удалось вернуть передачу.');
      return;
    }
    setReworkTarget(null);
    setReworkReason('');
    toast.success('Передача возвращена оператору');
    props.onRetry();
  };
  const runShiftAction = async (shift: ReadinessShiftDto, action: 'request-acceptance' | 'start' | 'handover' | 'decline') => {
    if (action === 'handover' && !commandSummary.trim()) {
      setCommandError('Укажите состояние техники и незавершённые работы.');
      return;
    }
    if (action === 'decline' && commandSummary.trim().length < 3) {
      setCommandError('Укажите, что мешает допустить установку к работе.');
      return;
    }
    setCommandPending(true);
    setCommandError(null);
    const response = await authFetch(`/api/readiness/shifts/${shift.id}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"shift-${shift.id}-v${shift.version}"`,
      },
      body: JSON.stringify(action === 'handover'
        ? { expectedVersion: shift.version, summary: commandSummary.trim() }
        : action === 'decline'
          ? { expectedVersion: shift.version, reason: commandSummary.trim() }
          : { expectedVersion: shift.version }),
    });
    setCommandPending(false);
    if (!response.ok) {
      const message = await commandFailure(response);
      setCommandError(message);
      if (response.status === 409) props.onRetry();
      return;
    }
    toast.success(action === 'start' ? 'Смена запущена'
      : action === 'request-acceptance' ? 'Запрос допуска отправлен диспетчеру'
        : action === 'decline' ? 'В допуске отказано, смена возвращена оператору'
          : 'Смена передана диспетчеру');
    setCommand(null);
    setCommandSummary('');
    props.onRetry();
  };

  return (
    <>
      <ScreenTitle
        heading="Смены"
        subtitle={period === 'day' ? `Сегодня, ${formatDateInTimezone(new Date(), props.bootstrap?.tenant.timezone, {day: 'numeric', month: 'long'})}` : 'Последние 7 дней'}
        actions={<div className="flex flex-wrap items-center gap-2"><div className="flex overflow-hidden rounded-lg border border-border bg-background"><button type="button" aria-pressed={period === 'day'} onClick={() => setPeriod('day')} className={cn('min-h-11 px-5 text-xs font-semibold', period === 'day' && 'bg-signal/10 text-signal-strong')}>День</button><button type="button" aria-pressed={period === 'week'} onClick={() => setPeriod('week')} className={cn('min-h-11 border-l border-border px-5 text-xs', period === 'week' ? 'bg-signal/10 font-semibold text-signal-strong' : 'text-muted-foreground')}>Неделя</button></div><Button type="button" disabled={!props.selectedId || !props.bootstrap?.capabilities.entities.shift.manage} onClick={() => void createShift()} className="min-h-11 bg-signal-strong hover:bg-signal-strong">+ Создать смену</Button></div>}
      />
      <div className="mb-2 flex flex-wrap gap-2 text-2xs text-muted-foreground"><span className="rounded border border-border bg-white px-2 py-1">Дневная 08:00–20:00</span><span className="rounded border border-border bg-white px-2 py-1">Ночная 20:00–08:00</span><span className="rounded border border-border bg-white px-2 py-1">Часовой пояс: {timezone}</span></div>
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="shift-start" label="Смен сегодня" value={todayShifts.length} />
        <RefKpi icon="technical-readiness" label="Готовы к запуску" value={ready.length} />
        <RefKpi icon="operator" label="Ждут приёмки" value={waiting.length} alert={waiting.length > 0} />
        <RefKpi icon="defect" label="Заблокированы" value={blocked.length} alert={blocked.length > 0} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto p-3')}>
          <h2 className="font-bold">График смен</h2>
          <div className="mt-3 hidden min-w-[760px] grid-cols-[220px_minmax(0,1fr)] md:grid">
            <div />
            <div className="grid grid-cols-9 px-2 text-3xs text-muted-foreground">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
          </div>
          <div className="mt-2 hidden min-w-[760px] divide-y divide-border md:block">
            {todayShifts.length > 0 ? todayShifts.slice(0, 8).map((shift) => {
              const equipment = props.equipment.find((item) => item.id === shift.equipmentId);
              const crew = activeCrews.find((item) => item.equipment?.id === shift.equipmentId);
              const equipmentCard = props.fleetCards.find((item) => item.id === shift.equipmentId);
              const start = shift.plannedStartAt ? new Date(shift.plannedStartAt) : null;
              const end = shift.plannedEndAt ? new Date(shift.plannedEndAt) : null;
              const startHour = start ? decimalHourInTimezone(start, timezone) : shift.type === 'DAY' ? 8 : 20;
              const duration = start && end ? Math.max(1, (end.getTime() - start.getTime()) / 3_600_000) : 8;
              const left = Math.max(0, Math.min(94, (startHour - 6) / 16 * 100));
              const width = Math.max(6, Math.min(100 - left, duration / 16 * 100));
              return (
                <div key={shift.id} className="grid grid-cols-[220px_minmax(0,1fr)] items-center py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EquipmentPhoto cardData={equipmentCard} name={equipment?.name || 'Установка'} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1"><div className="truncate text-2xs font-semibold">{equipment?.name || 'Установка'}</div><div className="mt-0.5 truncate text-3xs text-muted-foreground">{crew?.site?.name || 'Объект не назначен'}</div><div className="truncate text-3xs text-muted-foreground">{shift.type === 'DAY' ? 'Дневная' : 'Ночная'} смена</div>{shift.state === 'PLANNED' && props.bootstrap?.capabilities.entities.shift.manage && <button type="button" onClick={() => { setCommand({shift, action: 'request-acceptance'}); setCommandError(null); }} className="mt-1 min-h-11 rounded border border-signal/30 px-2 text-3xs font-semibold text-signal-strong">Запросить допуск</button>}{shift.state === 'PENDING_ACCEPTANCE' && props.bootstrap?.capabilities.entities.shift.decideHandover && <span className="mt-1 flex gap-1"><button type="button" onClick={() => { setCommand({shift, action: 'start'}); setCommandError(null); }} className="min-h-11 rounded border border-success/30 px-2 text-3xs font-semibold text-success-strong">Допустить</button><button type="button" onClick={() => { setCommand({shift, action: 'decline'}); setCommandSummary(''); setCommandError(null); }} className="min-h-11 rounded border border-destructive/30 px-2 text-3xs font-semibold text-destructive-strong">Отказать</button></span>}{shift.state === 'STARTED' && props.bootstrap?.capabilities.entities.shift.prepareHandover && <button type="button" onClick={() => { setCommand({shift, action: 'handover'}); setCommandError(null); }} className="mt-1 min-h-11 rounded border border-signal/30 px-2 text-3xs font-semibold text-signal-strong">Передать</button>}</div>
                    <span className="mr-2 shrink-0 rounded bg-muted px-1.5 py-1 text-3xs font-semibold">{SHIFT_STATE_LABEL[shift.state]}</span>
                  </div>
                  <div className="relative h-7 rounded bg-muted">
                    <div className={cn('absolute top-0.5 h-6 overflow-hidden rounded px-3 py-1 text-3xs font-semibold text-white', shift.state === 'STARTED' ? 'bg-success-strong' : shift.state === 'CANCELLED' ? 'bg-destructive-strong' : 'bg-signal-strong')} style={{ left: `${left}%`, width: `${width}%` }}>
                      {start ? formatTimeInTimezone(start, timezone) : '—'} – {end ? formatTimeInTimezone(end, timezone) : '—'}
                    </div>
                    <div className="absolute bottom-[-8px] top-[-8px] left-[23%] w-px bg-signal-strong"><span className="absolute -top-5 -translate-x-1/2 rounded bg-signal-strong px-1.5 py-0.5 text-3xs text-white">сейчас</span></div>
                  </div>
                </div>
              );
            }) : <div className="col-span-2 py-16 text-center text-sm text-muted-foreground">Смены на сегодня не созданы.</div>}
          </div>
          <div className="mt-3 space-y-2 md:hidden">{todayShifts.slice(0, 8).map((shift) => { const equipment = props.equipment.find((item) => item.id === shift.equipmentId); return <article key={shift.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><b className="truncate text-sm">{equipment?.name || 'Установка'}</b><span className="rounded bg-muted px-2 py-1 text-2xs">{SHIFT_STATE_LABEL[shift.state]}</span></div><div className="mt-2 text-xs text-muted-foreground">{shift.type === 'DAY' ? 'Дневная 08:00–20:00' : 'Ночная 20:00–08:00'} · v{shift.version}</div><div className="mt-3 flex gap-2">{shift.state === 'PLANNED' && props.bootstrap?.capabilities.entities.shift.manage && <Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'request-acceptance'}); setCommandError(null); }}>Запросить допуск</Button>}{shift.state === 'PENDING_ACCEPTANCE' && props.bootstrap?.capabilities.entities.shift.decideHandover && <><Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'start'}); setCommandError(null); }}>Допустить</Button><Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'decline'}); setCommandSummary(''); setCommandError(null); }}>Отказать</Button></>}{shift.state === 'STARTED' && props.bootstrap?.capabilities.entities.shift.prepareHandover && <Button type="button" variant="outline" className="min-h-11 flex-1 text-xs" onClick={() => { setCommand({shift, action: 'handover'}); setCommandError(null); }}>Передать</Button>}</div></article>; })}{todayShifts.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Смены не найдены.</div>}</div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача смены</h2><span className="rounded border border-border px-2 py-1 text-3xs text-muted-foreground">{waiting.length} действий</span></div>
          <div className="mt-2 space-y-2">
            {waiting.slice(0, 3).map((shift, index) => {
              const equipment = props.equipment.find((item) => item.id === shift.equipmentId);
              const crew = activeCrews.find((item) => item.equipment?.id === shift.equipmentId);
              const fleet = props.fleetCards.find((item) => item.id === shift.equipmentId);
              const handover = shift.handovers.find((item) => item.state === 'SUBMITTED');
              return (
                <div key={shift.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal' : 'border-border')}>
                  <div className="flex gap-2"><EquipmentPhoto cardData={fleet} name={equipment?.name || 'Установка'} className="h-11 w-11 shrink-0" /><div className="min-w-0"><div className="truncate text-xs font-bold">{equipment?.name || 'Установка'}</div><div className="mt-1 truncate text-3xs text-muted-foreground">{crew?.site?.name || 'Объект не назначен'} · {crew?.name || 'Экипаж не назначен'}</div></div></div>
                  <div className="mt-2 line-clamp-2 text-3xs leading-relaxed text-muted-foreground">{handover?.summary || 'Передача ожидает решения диспетчера'}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" disabled={!handover || !props.bootstrap?.capabilities.entities.shift.decideHandover} onClick={() => handover && void acceptHandover(handover)} className="min-h-11 w-full bg-signal-strong text-2xs hover:bg-signal-strong">Принять</Button><Button type="button" variant="outline" disabled={!handover || !props.bootstrap?.capabilities.entities.shift.decideHandover} onClick={() => { if (!handover) return; setReworkTarget(handover); setReworkReason(''); setCommandError(null); }} className="min-h-11 w-full text-2xs">На доработку</Button></div>
                </div>
              );
            })}
            {waiting.length === 0 && <div className="py-8 text-center text-xs text-muted-foreground">Передачи на приёмку отсутствуют.</div>}
          </div>
        </aside>
      </div>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Экипажи и загрузка</h2>
          <span className="text-xs text-muted-foreground">{activeCrews.length} активных экипажей</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-5">
          {activeCrews.length > 0 ? activeCrews.slice(0, 5).map((crew) => {
            const state = crew.equipment ? props.readinessByEquipment[crew.equipment.id] : null;
            const load = state?.score ?? 0;
            return (
              <article key={crew.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="truncate text-xs font-bold">{crew.name}</h3><p className="mt-1 truncate text-3xs text-muted-foreground">{crew.operator?.name || 'Оператор не назначен'} · {crew.assistants.length + (crew.operator ? 1 : 0)} чел.</p></div>
                  <span className={cn('rounded px-2 py-1 text-3xs font-semibold', state?.canOperate ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{state?.canOperate ? 'Готов' : 'Проверка'}</span>
                </div>
                <div className="mt-2 truncate text-2xs text-muted-foreground">{crew.equipment?.name || 'Техника не назначена'}</div>
                <div className="mt-1 text-3xs text-muted-foreground">{crew.site?.name || 'Объект не назначен'}</div>
                <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><div className={cn('h-full rounded-full', load >= 85 ? 'bg-success-strong' : 'bg-signal-strong')} style={{ width: `${load}%` }} /></div><b className="text-3xs">{load}%</b></div>
              </article>
            );
          }) : <div className="col-span-5 py-8 text-center text-sm text-muted-foreground">Активные экипажи не назначены.</div>}
        </div>
      </section>
      <ProcessRoleStrip
        ariaLabel="Роли передачи операторской смены"
        roles={[
          { label: 'Оператор', icon: 'operator', tasks: ['Открыть смену', 'Провести осмотр', 'Передать смену'], tone: 'green' },
          { label: 'Диспетчер', icon: 'crew', tasks: ['Проверить готовность', 'Принять передачу', 'Запустить смену'], tone: 'blue' },
          { label: 'Механик', icon: 'repair', tasks: ['Устранить дефект', 'Подтвердить выполнение', 'Вернуть технику'], tone: 'orange' },
        ]}
      />
      <CommandDialog
        open={reworkTarget !== null}
        pending={commandPending}
        title="Вернуть передачу на доработку"
        description={reworkTarget ? `Пакет v${reworkTarget.version} · ${timezone}` : undefined}
        onClose={() => { setReworkTarget(null); setReworkReason(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || reworkReason.trim().length < 3} onClick={() => reworkTarget && void reworkHandover(reworkTarget, reworkReason)} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Вернуть оператору'}</Button>}
      >
        <div className="space-y-3 text-sm">
          <p>Оператор получит пакет обратно и сможет передать его заново. Прежняя передача останется в журнале без изменений.</p>
          <label className="grid gap-1 font-medium" htmlFor="handover-rework-reason">
            Что нужно исправить
            <textarea
              id="handover-rework-reason"
              value={reworkReason}
              onChange={(event) => setReworkReason(event.target.value)}
              maxLength={1000}
              className="min-h-24 rounded-md border border-input bg-background p-3 font-normal"
            />
            <span className="text-2xs font-normal text-muted-foreground">Причина попадёт в журнал передач и будет видна оператору. От 3 до 1000 символов.</span>
          </label>
          {commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}
        </div>
      </CommandDialog>
      <CommandDialog
        open={command !== null}
        pending={commandPending}
        title={command?.action === 'start' ? 'Допустить смену к работе'
          : command?.action === 'request-acceptance' ? 'Запросить допуск у диспетчера'
            : command?.action === 'decline' ? 'Отказать в допуске'
              : 'Передать смену диспетчеру'}
        description={command ? `Версия ${command.shift.version} · ${command.shift.type === 'DAY' ? 'дневная' : 'ночная'} смена · ${timezone}` : undefined}
        onClose={() => { setCommand(null); setCommandSummary(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || ((command?.action === 'handover' || command?.action === 'decline') && commandSummary.trim().length < 3)} onClick={() => command && void runShiftAction(command.shift, command.action)} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Подтвердить действие'}</Button>}
      >
        <div className="space-y-3 text-sm"><p>{command?.action === 'start' ? 'Будет создан новый снимок готовности. Допуск заблокируется, если опубликованные правила требуют действующий наряд.' : command?.action === 'request-acceptance' ? 'Установка заявляется готовой. Смену откроет диспетчер после проверки доказательств — до его решения работать нельзя.' : command?.action === 'decline' ? 'Смена вернётся оператору в статус «Запланирована». Причина попадёт в журнал и будет видна оператору.' : 'После передачи диспетчер получит неизменяемую запись и сможет принять смену либо вернуть её на доработку.'}</p>{(command?.action === 'handover' || command?.action === 'decline') && <label className="grid gap-1 font-medium">{command.action === 'decline' ? 'Что мешает допустить установку' : 'Состояние техники и незавершённые работы'}<textarea value={commandSummary} onChange={(event) => setCommandSummary(event.target.value)} className="min-h-24 rounded-md border border-input bg-background p-3 font-normal" /></label>}{commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}</div>
      </CommandDialog>
    </>
  );
}

function PermitsScreen(props: ReferenceUiProps) {
  const [permitQuery, setPermitQuery] = useState('');
  const [permitFilter, setPermitFilter] = useState<'ALL' | 'APPROVED' | 'PENDING_APPROVAL'>('ALL');
  const [command, setCommand] = useState<{kind: 'create'} | {kind: 'action'; permit: WorkPermitDto; action: 'submit' | 'approve' | 'revoke'} | null>(null);
  const [commandText, setCommandText] = useState('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const states = Object.values(props.readinessByEquipment);
  const active = props.permits.filter((item) => item.state === 'APPROVED').length;
  const blocked = props.permits.filter((item) => ['EXPIRED', 'REVOKED'].includes(item.state)).length;
  const pending = props.permits.filter((item) => item.state === 'PENDING_APPROVAL').length;
  const crewByEquipment = new Map(props.crews.flatMap((crew) => crew.isActive && crew.equipment ? [[crew.equipment.id, crew] as const] : []));
  const filteredPermits = props.permits.filter((permit) => {
    if (permitFilter !== 'ALL' && permit.state !== permitFilter) return false;
    const equipmentName = props.equipment.find((item) => item.id === permit.equipmentId)?.name ?? '';
    const query = permitQuery.trim().toLocaleLowerCase('ru-RU');
    return !query || permit.id.toLocaleLowerCase('ru-RU').includes(query) || equipmentName.toLocaleLowerCase('ru-RU').includes(query) || permit.scope.toLocaleLowerCase('ru-RU').includes(query);
  });
  const createPermit = async (confirmed = false) => {
    if (!props.selectedId || !props.bootstrap?.capabilities.entities.permit.edit) return;
    if (!confirmed) { setCommand({kind: 'create'}); setCommandText(''); setCommandError(null); return; }
    if (!commandText.trim()) { setCommandError('Укажите состав и границы работ.'); return; }
    setCommandPending(true);
    const validFrom = new Date();
    const validTo = new Date(validFrom.getTime() + 12 * 3_600_000);
    const response = await authFetch('/api/readiness/work-permits', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        ...(props.bootstrap?.actor.actingAs === 'MECHANIC' ? { 'x-readiness-acting-as': 'MECHANIC' } : {}),
      },
      body: JSON.stringify({ equipmentId: props.selectedId, shiftId: null, risk: props.filters.risk ?? 'NORMAL', scope: commandText.trim(), validFrom: validFrom.toISOString(), validTo: validTo.toISOString() }),
    });
    setCommandPending(false);
    if (!response.ok) { setCommandError(await commandFailure(response)); if (response.status === 409) props.onRetry(); return; }
    toast.success('Наряд создан');
    setCommand(null);
    props.onRetry();
  };
  const runPermitAction = async (permit: WorkPermitDto, action: 'submit' | 'approve' | 'revoke', confirmed = false) => {
    if (!confirmed) { setCommand({kind: 'action', permit, action}); setCommandText(''); setCommandError(null); return; }
    if (action === 'revoke' && !commandText.trim()) { setCommandError('Укажите причину отзыва наряда.'); return; }
    setCommandPending(true);
    const response = await authFetch(`/api/readiness/work-permits/${permit.id}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"work-permit-${permit.id}-v${permit.version}"`,
        ...(action !== 'approve' && props.bootstrap?.actor.actingAs === 'MECHANIC' ? { 'x-readiness-acting-as': 'MECHANIC' } : {}),
      },
      body: JSON.stringify(action === 'revoke'
        ? { expectedVersion: permit.version, reason: commandText.trim() }
        : { expectedVersion: permit.version }),
    });
    setCommandPending(false);
    if (!response.ok) { setCommandError(await commandFailure(response)); if (response.status === 409) props.onRetry(); return; }
    toast.success(action === 'submit' ? 'Наряд отправлен на согласование' : action === 'approve' ? 'Наряд согласован' : 'Наряд отозван');
    setCommand(null);
    props.onRetry();
  };

  return (
    <>
      <ScreenTitle heading="Наряд-допуски" subtitle="Проверка условий и разрешений на выполнение работ" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => void downloadReadinessExport('permits', props.filters).catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>Экспорт</Button><Button type="button" disabled={!props.selectedId || !props.bootstrap?.capabilities.entities.permit.edit} onClick={() => void createPermit()} className="min-h-11 bg-signal-strong hover:bg-signal-strong">+ Создать наряд</Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="documents" label="Всего нарядов" value={props.permits.length} />
        <RefKpi icon="accepted" label="Действуют" value={active} />
        <RefKpi icon="history" label="На согласовании" value={pending} alert={pending > 0} />
        <RefKpi icon="defect" label="Заблокированы" value={blocked} alert={blocked > 0} />
      </section>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6 text-success-strong" /><h2 className="font-bold">Условия допуска подтверждены для {active} из {props.permits.length} нарядов</h2></div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-border"><div className="bg-success-strong" style={{ width: `${props.permits.length ? active / props.permits.length * 100 : 0}%` }} /><div className="bg-signal-strong" style={{ width: `${props.permits.length ? pending / props.permits.length * 100 : 0}%` }} /><div className="flex-1 bg-destructive-strong" /></div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-muted-foreground"><span>● <b>{active}</b> допущено</span><span className="text-signal-strong">● <b>{pending}</b> ожидают подтверждения</span><span className="text-destructive-strong">● <b>{blocked}</b> заблокировано</span><span className="xl:ml-auto text-muted-foreground">Фактическая проверка условий готовности</span></div>
      </section>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center justify-between"><div><h2 className="font-bold">Доказательства допуска</h2><p className="mt-0.5 text-2xs text-muted-foreground">Полный комплект подтверждений перед началом работ</p></div><span className="text-xs text-muted-foreground">{active} из {props.equipment.length} комплектов подтверждено</span></div>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[
            { title: 'Люди', icon: 'operator' as PilingIconName, state: props.crews.some((crew) => crew.isActive && crew.operator) ? 'pass' : 'missing', lines: [`Экипажей: ${props.crews.filter((crew) => crew.isActive).length}`, 'Удостоверения проверяются'] },
            { title: 'Техника', icon: 'equipment-rig' as PilingIconName, state: blocked > 0 ? 'warning' : 'pass', lines: [`Ограничений: ${blocked}`, `Осмотрено: ${states.filter((item) => item.evidence.some((entry) => entry.key === 'inspection' && entry.state === 'pass')).length} из ${states.length}`] },
            { title: 'Место работ', icon: 'site' as PilingIconName, state: props.crews.some((crew) => crew.isActive && crew.site) ? 'pass' : 'missing', lines: [`Объектов: ${new Set(props.crews.flatMap((crew) => crew.site?.id ? [crew.site.id] : [])).size}`, 'Схема требует подтверждения'] },
            { title: 'Документы', icon: 'documents' as PilingIconName, state: pending > 0 ? 'warning' : 'pass', lines: [`Подтверждено: ${states.filter((item) => item.evidence.some((entry) => entry.key === 'maintenance' && entry.state === 'pass')).length}`, pending > 0 ? `Ожидают: ${pending}` : 'Решения подтверждены'] },
          ].map((item) => (
            <article key={item.title} className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-info/10 text-info-strong"><PilingIcon name={item.icon} size={12} decorative /></span><div className="min-w-0 flex-1"><h3 className="text-xs font-bold">{item.title}</h3><EvidenceState state={item.state} /></div></div>
              <div className="mt-2 space-y-1 text-3xs text-muted-foreground">{item.lines.map((line) => <div key={line}>• {line}</div>)}</div>
            </article>
          ))}
        </div>
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'overflow-x-auto')}>
          <div className="p-3"><h2 className="font-bold">Реестр нарядов-допусков</h2><div className="mt-2 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск нарядов" value={permitQuery} onChange={(event) => setPermitQuery(event.target.value)} placeholder="Номер, установка, объект" className="min-h-11 bg-muted pl-9 text-xs" /></div>{([['ALL', 'Все'], ['APPROVED', 'Действующие'], ['PENDING_APPROVAL', 'На согласовании']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={permitFilter === value} onClick={() => setPermitFilter(value)} className={cn('min-h-11 rounded border px-3 text-2xs', permitFilter === value ? 'border-info bg-info/10 text-info-strong' : 'border-border text-muted-foreground')}>{label}</button>)}</div></div>
          <div className="hidden min-w-[880px] grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_120px] border-y border-border bg-muted px-3 py-2 text-3xs uppercase tracking-wide text-muted-foreground md:grid"><span>№ наряда</span><span>Установка</span><span>Объект</span><span>Смена</span><span>Действует до</span><span>Готовность</span><span>Статус</span><span>Действие</span></div>
          <div className="hidden max-h-[230px] min-w-[760px] divide-y divide-border overflow-y-auto md:block">
            {filteredPermits.map((permit, index) => {
              const item = props.equipment.find((entry) => entry.id === permit.equipmentId);
              const crew = crewByEquipment.get(permit.equipmentId);
              const current = props.currentReadiness.find((entry) => entry.equipmentId === permit.equipmentId);
              return (
                <div key={permit.id} className={cn('grid grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_120px] items-center px-3 py-2 text-2xs hover:bg-signal/5', index === 0 && 'bg-signal/5 ring-1 ring-inset ring-signal/25')}>
                  <span className="font-bold">НД-{permit.id.slice(-8).toUpperCase()}</span><span>{item?.name || 'Установка'}</span><span>{crew?.site?.name || 'Не назначен'}</span><span>{permit.shiftId ? permit.shiftId.slice(-6) : '—'}</span><span>{formatDateInTimezone(permit.validTo, props.bootstrap?.tenant.timezone, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span><span><b className="text-signal-strong">{current?.score ?? '—'}%</b></span><span className={cn('font-semibold', permit.state === 'APPROVED' ? 'text-success-strong' : permit.state === 'PENDING_APPROVAL' ? 'text-signal-strong' : 'text-muted-foreground')}>{PERMIT_STATE_LABEL[permit.state]}</span><span>{permit.state === 'DRAFT' && props.bootstrap?.capabilities.entities.permit.edit && <button type="button" onClick={() => void runPermitAction(permit, 'submit')} className="min-h-11 rounded border border-signal/30 px-2 font-semibold text-signal-strong">Отправить</button>}{permit.state === 'PENDING_APPROVAL' && (props.bootstrap?.capabilities.entities.permit.approveDispatcher || props.bootstrap?.capabilities.entities.permit.approveAdmin) && <button type="button" onClick={() => void runPermitAction(permit, 'approve')} className="min-h-11 rounded border border-success/30 px-2 font-semibold text-success-strong">Согласовать</button>}{permit.state === 'APPROVED' && props.bootstrap?.capabilities.entities.permit.edit && <button type="button" onClick={() => void runPermitAction(permit, 'revoke')} className="min-h-11 rounded border border-destructive/30 px-2 font-semibold text-destructive-strong">Отозвать</button>}</span>
                </div>
              );
            })}
            {filteredPermits.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">По выбранным условиям наряды не найдены.</div>}
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {filteredPermits.map((permit) => {
              const item = props.equipment.find((equipment) => equipment.id === permit.equipmentId);
              const crew = crewByEquipment.get(permit.equipmentId);
              const current = props.currentReadiness.find((entry) => entry.equipmentId === permit.equipmentId);
              const action = permit.state === 'DRAFT' ? 'submit' : permit.state === 'PENDING_APPROVAL' ? 'approve' : permit.state === 'APPROVED' ? 'revoke' : null;
              const canAct = action === 'submit' ? props.bootstrap?.capabilities.entities.permit.edit
                : action === 'approve' ? (props.bootstrap?.capabilities.entities.permit.approveDispatcher || props.bootstrap?.capabilities.entities.permit.approveAdmin)
                  : action === 'revoke' ? props.bootstrap?.capabilities.entities.permit.edit : false;
              return <article key={permit.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="block truncate">НД-{permit.id.slice(-8).toUpperCase()}</b><span className="mt-1 block truncate text-muted-foreground">{item?.name || 'Установка'} · {crew?.site?.name || 'Объект не назначен'}</span></div><span className={cn('shrink-0 rounded px-2 py-1 text-3xs font-semibold', permit.state === 'APPROVED' ? 'bg-success/10 text-success-strong' : permit.state === 'PENDING_APPROVAL' ? 'bg-signal/10 text-signal-strong' : 'bg-muted text-muted-foreground')}>{PERMIT_STATE_LABEL[permit.state]}</span></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-2xs"><span className="text-muted-foreground">Действует до<br /><b className="text-foreground">{formatDateTimeInTimezone(permit.validTo, props.bootstrap?.tenant.timezone)}</b></span><span className="text-muted-foreground">Готовность<br /><b className="text-signal-strong">{current?.score ?? '—'}%</b></span></div>
                {action && canAct && <Button type="button" variant="outline" className="mt-3 min-h-11 w-full text-xs" onClick={() => void runPermitAction(permit, action)}>{action === 'submit' ? 'Отправить' : action === 'approve' ? 'Согласовать' : 'Отозвать'}</Button>}
              </article>;
            })}
            {filteredPermits.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">По выбранным условиям наряды не найдены.</div>}
          </div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Ожидают согласования</h2><span className="text-xs text-muted-foreground">{pending}</span></div>
          <div className="mt-2 space-y-2">{props.permits.filter((item) => item.state === 'PENDING_APPROVAL').slice(0, 2).map((permit, index) => <div key={permit.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal' : 'border-border')}><div className="text-xs font-bold">НД-{permit.id.slice(-8).toUpperCase()}</div><div className="mt-1 text-3xs text-muted-foreground">{props.equipment.find((item) => item.id === permit.equipmentId)?.name || 'Установка'}</div><div className="mt-1 line-clamp-2 text-3xs text-signal-strong">{permit.risk === 'ELEVATED' ? 'Повышенный риск · требуется два согласования' : 'Ожидает решения диспетчера'}</div></div>)}</div>
          <div className="mt-3 border-t border-border pt-3"><h3 className="text-xs font-bold">Журнал согласования</h3><div className="mt-2 space-y-1.5 text-3xs"><div className="text-success-strong">● Создан мастером</div><div className="text-info-strong">● Проверен инженером ОТ</div><div className="text-signal-strong">● Ожидает диспетчера · {pending}</div></div></div>
        </aside>
      </div>
      <ProcessRoleStrip
        ariaLabel="Роли согласования наряда-допуска"
        roles={[
          { label: 'Мастер', icon: 'operator', tasks: ['Формирует условия', 'Проверяет экипаж и технику', 'Прикладывает документы'], tone: 'green' },
          { label: 'Инженер ОТ', icon: 'inspection', tasks: ['Проверяет безопасность', 'Оценивает риски', 'Фиксирует замечания'], tone: 'blue' },
          { label: 'Диспетчер', icon: 'crew', tasks: ['Проверяет условия', 'Подтверждает допуск', 'Разрешает начало работ'], tone: 'orange' },
        ]}
      />
      <CommandDialog
        open={command !== null}
        pending={commandPending}
        title={command?.kind === 'create' ? 'Создать наряд-допуск' : command?.action === 'submit' ? 'Отправить на согласование' : command?.action === 'approve' ? 'Согласовать наряд' : 'Отозвать наряд'}
        description={command?.kind === 'action' ? `Версия ${command.permit.version} · риск ${command.permit.risk === 'ELEVATED' ? 'повышенный' : 'обычный'} · ${props.bootstrap?.tenant.timezone ?? 'Europe/Moscow'}` : `Срок действия: 12 часов · ${props.bootstrap?.tenant.timezone ?? 'Europe/Moscow'}`}
        onClose={() => { setCommand(null); setCommandText(''); setCommandError(null); }}
        footer={<Button type="button" disabled={commandPending || ((command?.kind === 'create' || (command?.kind === 'action' && command.action === 'revoke')) && !commandText.trim())} onClick={() => command?.kind === 'create' ? void createPermit(true) : command?.kind === 'action' ? void runPermitAction(command.permit, command.action, true) : undefined} className="bg-signal-strong hover:bg-signal-strong">{commandPending ? 'Выполняется…' : 'Подтвердить действие'}</Button>}
      >
        <div className="space-y-3 text-sm"><p>{command?.kind === 'create' ? 'Наряд будет создан как черновик. Для повышенного риска потребуются решения диспетчера и администратора.' : command?.action === 'approve' ? 'Решение попадёт в доказательный журнал и вызовет новый снимок готовности.' : command?.action === 'submit' ? 'После отправки содержание нельзя менять без сброса согласований.' : 'Отзыв немедленно прекращает действие наряда и может заблокировать запуск смены.'}</p>{(command?.kind === 'create' || (command?.kind === 'action' && command.action === 'revoke')) && <label className="grid gap-1 font-medium">{command.kind === 'create' ? 'Состав и границы работ' : 'Причина отзыва'}<textarea value={commandText} onChange={(event) => setCommandText(event.target.value)} className="min-h-24 rounded-md border border-input bg-background p-3 font-normal" /></label>}{commandError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{commandError}</p>}</div>
      </CommandDialog>
    </>
  );
}

function MaintenanceScreen(props: ReferenceUiProps) {
  const [maintenanceFilter, setMaintenanceFilter] = useState<'ALL' | 'CRITICAL' | 'ACTIVE' | 'PLANNED'>('ALL');
  const [maintenanceQuery, setMaintenanceQuery] = useState('');
  const open = props.maintenance.filter((record) => !['DONE', 'CANCELLED'].includes(record.status));
  const critical = open.filter((record) => ['CRITICAL', 'HIGH'].includes(record.priority));
  const planned = open.filter((record) => ['PLANNED', 'ASSIGNED'].includes(record.status));
  const servicePercent = props.equipment.length ? Math.round(((props.equipment.length - critical.length) / props.equipment.length) * 100) : 0;
  const displayedMaintenance = props.maintenance.filter((record) => {
    if (maintenanceFilter === 'CRITICAL' && !['CRITICAL', 'HIGH'].includes(record.priority)) return false;
    if (maintenanceFilter === 'ACTIVE' && !['IN_PROGRESS', 'ASSIGNED'].includes(record.status)) return false;
    if (maintenanceFilter === 'PLANNED' && !['PLANNED', 'ASSIGNED'].includes(record.status)) return false;
    const query = maintenanceQuery.trim().toLocaleLowerCase('ru-RU');
    return !query || record.title.toLocaleLowerCase('ru-RU').includes(query) || record.equipment?.name.toLocaleLowerCase('ru-RU').includes(query);
  });

  return (
    <>
      <ScreenTitle heading="Обслуживание" subtitle="Техническое состояние и план работ" actions={<div className="flex flex-wrap gap-2"><Button asChild className="min-h-11 bg-signal-strong hover:bg-signal-strong"><Link href="/admin/maintenance">+ Создать заявку</Link></Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="defect" label="Критические дефекты" value={critical.length} alert={critical.length > 0} />
        <RefKpi icon="work-order" label="Работы сегодня" value={open.length} />
        <RefKpi icon="maintenance-due" label="Ближайшие ТО" value={planned.length} />
        <RefKpi icon="technical-readiness" label="Готовность сервиса" value={`${Math.max(0, servicePercent)}%`} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Заявки и работы</h2>
          <div className="mt-3 flex flex-wrap gap-2">{([['ALL', 'Все'], ['CRITICAL', 'Критические'], ['ACTIVE', 'В работе'], ['PLANNED', 'Плановые']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={maintenanceFilter === value} onClick={() => setMaintenanceFilter(value)} className={cn('min-h-11 rounded border px-3 text-xs', maintenanceFilter === value ? 'border-signal bg-signal/10 text-signal-strong' : 'border-border text-muted-foreground')}>{label}</button>)}<div className="relative min-w-[220px] flex-1 xl:ml-auto xl:max-w-64"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Поиск по обслуживанию" value={maintenanceQuery} onChange={(event) => setMaintenanceQuery(event.target.value)} placeholder="Поиск по технике или заявке" className="min-h-11 bg-muted pl-9 text-xs" /></div></div>
          <div className="mt-2 max-h-[364px] space-y-2 overflow-y-auto pr-1">
            {displayedMaintenance.length > 0 ? displayedMaintenance.slice(0, 8).map((record, index) => {
              const fleet = record.equipment ? props.fleetCards.find((item) => item.id === record.equipment?.id) : undefined;
              const criticalRecord = ['CRITICAL', 'HIGH'].includes(record.priority);
              return (
                <article key={record.id} className={cn('flex min-h-[86px] flex-wrap items-center gap-3 rounded-lg border-l-[3px] p-2.5 sm:flex-nowrap', criticalRecord ? 'border-y border-r border-destructive/25 border-l-destructive bg-destructive/10' : index % 2 ? 'border-y border-r border-info/25 border-l-info bg-info/10' : 'border-y border-r border-signal/25 border-l-signal bg-signal/10')}>
                  <EquipmentPhoto cardData={fleet} name={record.equipment?.name || record.title} className="h-14 w-14 shrink-0" />
                  <span className={cn('grid h-9 w-9 place-items-center rounded-full', criticalRecord ? 'bg-destructive/10 text-destructive-strong' : 'bg-white text-signal-strong')}>{criticalRecord ? <AlertTriangle className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}</span>
                  <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{record.title}</h3><div className="mt-0.5 text-2xs text-muted-foreground">{record.equipment?.name || 'Установка не указана'}</div><div className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">{record.description || 'Описание не заполнено'}</div><div className="mt-1 text-3xs text-muted-foreground">▣ {record.scheduledAt ? formatDateTimeInTimezone(record.scheduledAt, props.bootstrap?.tenant.timezone) : 'Срок не задан'}</div></div>
                  <div className="w-full text-left text-2xs sm:w-36 sm:text-right"><div className={cn('font-semibold', criticalRecord ? 'text-destructive-strong' : 'text-info-strong')}>{criticalRecord ? 'Критическое' : STATUS_LABEL[record.status as MaintenanceStatus] ?? record.status}</div><div className="mt-1 text-muted-foreground">Приоритет · <b className="text-muted-foreground">{PRIORITY_LABEL[record.priority as MaintenancePriority] ?? record.priority}</b></div><Button asChild className="mt-2 h-8 bg-signal-strong text-2xs hover:bg-signal-strong"><Link href={`/admin/maintenance/${record.id}`}>Открыть заявку</Link></Button></div>
                </article>
              );
            }) : <div className="py-20 text-center text-sm text-muted-foreground">Заявки обслуживания отсутствуют.</div>}
          </div>
        </section>
        <aside className="space-y-3">
          <section className={cn(card, 'p-3')}>
            <h2 className="font-bold">Сервисный план по моточасам</h2>
            <div className="mt-2 divide-y divide-border">{props.equipment.slice(0, 5).map((item) => <div key={item.id} className="flex items-center gap-2 py-2"><span className="text-signal-strong">⚠</span><EquipmentPhoto cardData={props.fleetCards.find((entry) => entry.id === item.id)} name={item.name} className="h-8 w-8 shrink-0" /><div className="min-w-0"><div className="truncate text-2xs font-semibold">{item.name}</div><div className="text-3xs text-muted-foreground">{item.nextMaintenanceAtHours != null ? `ТО через ${Math.max(0, item.nextMaintenanceAtHours - (item.engineHoursTotal ?? 0)).toLocaleString('ru-RU')} м/ч` : 'Регламент не задан'}</div></div></div>)}</div>
            <Button asChild variant="outline" className="mt-2 h-8 w-full text-2xs"><Link href="/admin/maintenance"><CalendarClock className="mr-2 h-4 w-4" />Открыть календарь</Link></Button>
          </section>
          <section className={cn(card, 'p-3')}><h2 className="font-bold">Запчасти и материалы</h2><div className="mt-2 grid grid-cols-2 gap-2">{['Фильтр топливный', 'Рукав РВД', 'Масло гидравлическое', 'Комплект уплотнений'].map((item) => <div key={item} className="rounded-lg border border-border p-2 text-center"><div className="text-3xs font-semibold">{item}</div><div className="mt-1 text-3xs text-muted-foreground">Наличие не учтено</div></div>)}</div></section>
        </aside>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><div><h2 className="font-bold">Загрузка механиков</h2><p className="mt-1 text-xs text-muted-foreground">Распределение открытых заявок между исполнителями</p></div><span className="text-xs text-muted-foreground">{open.length} работ в очереди</span></div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {Array.from({ length: Math.min(3, Math.max(1, open.length)) }, (_, index) => {
              const assigned = open.filter((_, recordIndex) => recordIndex % 3 === index);
              const workload = open.length ? Math.round(assigned.length / Math.max(1, Math.ceil(open.length / 3)) * 100) : 0;
              return (
                <article key={index} className="rounded-lg border border-border p-2">
                  <div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-signal/10 text-signal-strong"><Wrench className="h-5 w-5" /></span><div><h3 className="text-xs font-bold">Исполнитель не назначен</h3><p className="text-3xs text-muted-foreground">{assigned.length} заявок</p></div></div>
                  <div className="mt-3 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-signal-strong" style={{ width: `${Math.min(100, workload)}%` }} /></div><b className="text-3xs">{Math.min(100, workload)}%</b></div>
                  <div className="mt-3 space-y-1 text-3xs text-muted-foreground">{assigned.slice(0, 2).map((record) => <div key={record.id} className="truncate">• {record.title}</div>)}{assigned.length === 0 && <div>Свободен для назначения</div>}</div>
                </article>
              );
            })}
          </div>
        </section>
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Доказательства выполнения</h2><span className="text-xs text-muted-foreground">{props.maintenance.filter((record) => record.status === 'DONE').length} подтверждено</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              ['Фото до ремонта', 'camera' as PilingIconName],
              ['Фото после ремонта', 'camera' as PilingIconName],
              ['PDF / Акт выполненных работ', 'documents' as PilingIconName],
              ['Подтверждение механика', 'accepted' as PilingIconName],
            ].map(([label, icon]) => (
              <div key={label} className="rounded-lg border border-border p-2">
                <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded bg-info/10 text-info-strong"><PilingIcon name={icon as PilingIconName} size={11} decorative /></span><span className="min-w-0 flex-1 text-3xs font-semibold">{label}</span></div>
                <span className="mt-1 block text-3xs text-muted-foreground">Нет подтверждения</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function ReportsScreen(props: ReferenceUiProps) {
  const [reportPeriod, setReportPeriod] = useState<'day' | 'week'>('day');
  const states = Object.values(props.readinessByEquipment);
  const authoritative = props.currentReadiness.length > 0 ? props.currentReadiness : null;
  const ready = authoritative
    ? authoritative.filter((item) => item.status === 'READY').length
    : states.filter((item) => item.canOperate).length;
  const blocked = authoritative
    ? authoritative.filter((item) => item.status === 'BLOCKED').length
    : states.filter((item) => ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const readinessPercent = authoritative?.length
    ? Math.round(authoritative.reduce((sum, item) => sum + item.score, 0) / authoritative.length * 10) / 10
    : states.length ? Math.round(ready / states.length * 1000) / 10 : 0;
  const snapshotRows = props.readinessHistory.map((snapshot) => ({
    id: snapshot.id,
    completedAt: snapshot.calculatedAt,
    createdAt: snapshot.calculatedAt,
    equipmentName: props.equipment.find((item) => item.id === snapshot.equipmentId)?.name || 'Установка',
    title: `Снимок готовности · ${snapshot.triggerType ?? 'событие'}`,
    type: 'READINESS_SNAPSHOT',
    status: `${snapshot.status} · ${snapshot.score}%`,
  }));
  const decisionRows = (props.audit?.data ?? []).filter((event) => ['WorkPermit', 'ShiftHandover', 'Shift'].includes(event.entity.type)).map((event) => ({
    id: event.id,
    completedAt: event.occurredAt,
    createdAt: event.occurredAt,
    equipmentName: event.entity.type,
    title: event.action,
    type: 'AUDIT_DECISION',
    status: `Зафиксировано · #${event.sequence}`,
  }));
  const journalRows = [...snapshotRows, ...decisionRows]
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
  const completed = journalRows.length;
  const blockerRows = [
    ['Ремонт и дефекты', blocked],
    ['Осмотр', states.filter((item) => item.evidence.find((e) => e.key === 'inspection')?.state !== 'pass').length],
    ['Экипаж', states.filter((item) => item.evidence.find((e) => e.key === 'crew')?.state !== 'pass').length],
    ['Документы', states.filter((item) => item.evidence.find((e) => e.key === 'maintenance')?.state !== 'pass').length],
  ] as const;
  const maxBlocker = Math.max(1, ...blockerRows.map(([, value]) => value));
  const dailyTrend = Object.entries(props.readinessHistory.reduce<Record<string, number[]>>((result, snapshot) => {
    const date = new Date(snapshot.calculatedAt);
    if (reportPeriod === 'week') date.setDate(date.getDate() - date.getDay());
    const day = date.toISOString().slice(0, 10);
    (result[day] ??= []).push(snapshot.score);
    return result;
  }, {})).sort(([left], [right]) => left.localeCompare(right)).slice(-30).map(([day, scores]) => ({
    day,
    score: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
  }));
  const trendPoints = dailyTrend.length > 0
    ? dailyTrend.map((item, index) => `${dailyTrend.length === 1 ? 300 : index / (dailyTrend.length - 1) * 600},${200 - item.score * 2}`).join(' ')
    : '';

  return (
    <>
      <ScreenTitle heading="Отчёты" subtitle="Аналитика доказательной готовности" actions={<div className="flex flex-wrap gap-2"><span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs">▣ Текущий срез · {formatDateInTimezone(new Date(), props.bootstrap?.tenant.timezone)}</span><Button className="bg-signal-strong hover:bg-signal-strong" onClick={() => void downloadReadinessExport('reports', props.filters).catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}>Экспорт</Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(5)}>
        <RefKpi icon="technical-readiness" label="Готовность парка" value={`${readinessPercent}%`} detail="текущий срез" />
        <RefKpi icon="shift-start" label="Смен допущено" value={ready} detail="по текущим доказательствам" />
        <RefKpi icon="defect" label="Заблокировано" value={blocked} alert={blocked > 0} />
        <RefKpi icon="history" label="Среднее решение" value="—" detail="нет истории решений" />
        <RefKpi icon="documents" label="Доказательств" value={completed} detail="снимки и решения audit-chain" />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Динамика готовности за 30 дней</h2><div className="flex overflow-hidden rounded border border-border"><button type="button" aria-pressed={reportPeriod === 'day'} onClick={() => setReportPeriod('day')} className={cn('min-h-11 px-3 text-xs', reportPeriod === 'day' && 'bg-signal-strong text-white')}>День</button><button type="button" aria-pressed={reportPeriod === 'week'} onClick={() => setReportPeriod('week')} className={cn('min-h-11 px-3 text-xs', reportPeriod === 'week' && 'bg-signal-strong text-white')}>Неделя</button></div></div>
          <div className="relative mt-3 h-[150px] border-b border-l border-border">
            {[0, 1, 2, 3].map((line) => <div key={line} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${line * 33}%` }} />)}
            {trendPoints ? <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Динамика средней готовности"><polyline points={trendPoints} fill="none" stroke="var(--signal)" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg> : <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">История снимков пока не накоплена</div>}
            <div className="absolute right-3 top-3 rounded border border-border bg-white px-3 py-2 text-xs"><b>{readinessPercent}%</b><br /><span className="text-muted-foreground">сегодня</span></div>
          </div>
        </section>
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Причины блокировки · Парето</h2>
          <div className="mt-4 space-y-3">{blockerRows.map(([label, value], index) => <div key={label} className="grid grid-cols-[130px_minmax(0,1fr)_30px] items-center gap-3 text-xs"><span className="text-right">{label}</span><div className="h-4 overflow-hidden bg-muted"><div className={cn('h-full', index === 0 ? 'bg-destructive-strong' : 'bg-signal-strong')} style={{ width: `${value / maxBlocker * 100}%` }} /></div><b>{value}</b></div>)}</div>
        </section>
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Готовность по установкам</h2>
          <div className="mt-3 space-y-2">{props.equipment.slice(0, 5).map((item) => { const state = props.readinessByEquipment[item.id]; const score = state?.score ?? 0; return <div key={item.id} className="grid grid-cols-[160px_minmax(0,1fr)_40px_70px] items-center gap-2 text-2xs"><span className="truncate font-semibold">{item.name}</span><div className="h-2 overflow-hidden bg-border"><div className={cn('h-full', score >= 85 ? 'bg-success-strong' : 'bg-signal-strong')} style={{ width: `${score}%` }} /></div><b>{state?.score ?? '—'}%</b><span className="rounded bg-success/10 px-2 py-1 text-center text-3xs text-success-strong">{score >= 85 ? 'Высокая' : 'Средняя'}</span></div>; })}</div>
        </section>
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Результат допуска</h2>
          <div className="mt-3 flex items-center gap-6">
            <div className="relative h-24 w-24 rounded-full" style={{ background: `conic-gradient(var(--success) 0 ${readinessPercent}%, var(--signal) ${readinessPercent}% ${Math.min(100, readinessPercent + 10)}%, var(--destructive) ${Math.min(100, readinessPercent + 10)}% 100%)` }}><div className="absolute inset-3 grid place-items-center rounded-full bg-white text-center"><div><b className="font-mono text-xl">{states.length}</b><div className="text-3xs text-muted-foreground">установок</div></div></div></div>
            <div className="space-y-3 text-xs"><div><span className="text-success-strong">●</span> Допущено <b className="ml-3">{ready}</b></div><div><span className="text-signal-strong">●</span> С замечаниями <b className="ml-3">{states.length - ready - blocked}</b></div><div><span className="text-destructive-strong">●</span> Заблокировано <b className="ml-3">{blocked}</b></div></div>
          </div>
        </section>
      </div>
      <section className={cn(card, 'mt-2 overflow-x-auto')}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div><h2 className="font-bold">Доказательный журнал</h2><p className="mt-1 text-xs text-muted-foreground">Неизменяемая история решений и подтверждений</p></div>
          <div className="flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1 sm:w-64"><Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" /><Input className="h-8 bg-muted pl-9 text-xs" placeholder="Поиск по установке или событию" /></div><Button variant="outline" className="h-8 text-xs">Фильтры</Button><Button variant="outline" className="h-8 text-xs" onClick={() => props.onViewChange('maintenance')}>Открыть полный журнал</Button></div>
        </div>
        <div className="hidden min-w-[760px] grid-cols-[160px_190px_minmax(0,1fr)_150px_120px] border-y border-border bg-muted px-4 py-2 text-3xs uppercase tracking-wide text-muted-foreground md:grid"><span>Дата и время</span><span>Установка</span><span>Событие</span><span>Тип</span><span>Статус</span></div>
        <div className="hidden min-w-[760px] divide-y divide-border md:block">
          {journalRows.length > 0 ? journalRows.slice(0, 4).map((record) => (
            <div key={record.id} className="grid grid-cols-[160px_190px_minmax(0,1fr)_150px_120px] items-center px-4 py-2 text-2xs">
              <span className="text-muted-foreground">{formatDateTimeInTimezone(record.completedAt || record.createdAt, props.bootstrap?.tenant.timezone)}</span>
              <span className="font-semibold">{record.equipmentName}</span>
              <span className="truncate">{record.title}</span>
              <span className="text-muted-foreground">{record.type}</span>
              <span><span className={cn('rounded px-2 py-1 text-3xs font-semibold', record.status === 'DONE' ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{STATUS_LABEL[record.status as MaintenanceStatus] ?? record.status}</span></span>
            </div>
          )) : <div className="py-10 text-center text-sm text-muted-foreground">Записи доказательного журнала отсутствуют.</div>}
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {journalRows.length > 0 ? journalRows.slice(0, 10).map((record) => <article key={record.id} className="rounded-lg border border-border p-3 text-xs"><div className="flex items-start justify-between gap-2"><b className="min-w-0 truncate">{record.equipmentName}</b><span className={cn('shrink-0 rounded px-2 py-1 text-3xs font-semibold', record.status === 'DONE' ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{STATUS_LABEL[record.status as MaintenanceStatus] ?? record.status}</span></div><div className="mt-2 font-medium">{record.title}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground"><span>{formatDateTimeInTimezone(record.completedAt || record.createdAt, props.bootstrap?.tenant.timezone)}</span><span>{TYPE_LABEL[record.type as MaintenanceType] ?? record.type}</span></div></article>) : <div className="py-8 text-center text-sm text-muted-foreground">Записи доказательного журнала отсутствуют.</div>}
        </div>
      </section>
      <section className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-signal/25 bg-signal/10 px-3 py-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-signal-strong" />
        <div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-signal-strong">Основной резерв готовности: {blockerRows[0][0].toLowerCase()} формирует {Math.round(blockerRows[0][1] / Math.max(1, blockerRows.reduce((sum, [, value]) => sum + value, 0)) * 100)}% блокировок</h2><p className="mt-0.5 text-xs text-warning-strong">Приоритетная зона для сокращения простоев и восстановления доступности парка.</p></div>
        <Button variant="outline" className="border-signal text-signal-strong" onClick={() => props.onViewChange('maintenance')}>Перейти к обслуживанию →</Button>
      </section>
    </>
  );
}

function SettingsWorkspace(props: ReferenceUiProps) {
  return (
    <div className="grid min-h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="sticky top-12 z-20 flex flex-col border-b border-border bg-card px-2 py-2 xl:static xl:border-b-0 xl:border-r xl:px-3 xl:py-4">
        <div className="mb-3 hidden text-xs font-bold text-muted-foreground xl:block">Разделы</div>
        <nav className="flex gap-1 overflow-x-auto xl:block xl:space-y-1">
          {SETTINGS_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => props.onSettingsSectionChange(item.id)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap border-l-2 px-3 text-left text-xs transition xl:w-full',
                  props.settingsSection === item.id
                    ? 'border-signal bg-signal/10 font-semibold text-signal-strong'
                    : 'border-transparent text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto hidden items-center gap-2 border-t border-border pt-3 text-3xs text-muted-foreground xl:flex">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{props.bootstrap?.tenant.name?.trim() || 'Организация'} · Основной контур</span>
        </div>
      </aside>
      <main className="min-w-0 px-2 sm:px-4">
        {props.settingsSection === 'rules' && (
          <RulesSettings
            key={`${props.rulesState.published.version}:${props.rulesState.draft?.updatedAt ?? 'published'}`}
            {...props}
          />
        )}
        {props.settingsSection === 'checklists' && <ChecklistsSettings />}
        {props.settingsSection === 'roles' && <RolesSettings bootstrap={props.bootstrap} />}
        {props.settingsSection === 'dictionaries' && (
          <DictionariesSettings
            equipment={props.equipment}
            bootstrap={props.bootstrap}
            onExport={() => void downloadReadinessExport('dictionary', props.filters).catch((error) => toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт'))}
          />
        )}
        {props.settingsSection === 'notifications' && <NotificationsSettings isAdmin={props.bootstrap?.actor.role === 'ADMIN'} />}
        {props.settingsSection === 'integrations' && (
          <IntegrationsSettings
            devices={Object.values(props.details).flatMap((detail) => detail.telematicsDevices ?? [])}
            bootstrap={props.bootstrap}
          />
        )}
        {props.settingsSection === 'audit' && (
          <AuditSettings
            audit={props.audit}
            bootstrap={props.bootstrap}
            canExport={Boolean(props.bootstrap?.capabilities.entities.audit.export)}
            filtersBar={<ReadinessFiltersBar filters={props.filters} onChange={props.onFiltersChange} mode="audit" />}
            onExport={(events) => downloadCsv('readiness-audit.csv', [['Последовательность', 'Дата', 'Автор', 'Действие', 'Объект', 'Hash'], ...events.map((event) => [event.sequence, event.occurredAt, event.actor.name, auditActionLabel(event.action), `${auditEntityLabel(event.entity.type)}:${event.entity.id}`, event.hash])])}
          />
        )}
      </main>
    </div>
  );
}

/** Своя иконка на критерий — по макету, но из общего набора модуля. */
const CRITERION_ICONS: Record<ReadinessCriterionKey, typeof ClipboardCheck> = {
  INSPECTION: ClipboardCheck,
  ENGINE_HOURS: Gauge,
  PERMIT: FileText,
  MAINTENANCE: Wrench,
  ACCEPTANCE: CheckCircle2,
};

const ROLE_COLUMNS = ['Оператор', 'Диспетчер', 'Механик', 'Админ'] as const;

/**
 * Сводка матрицы доступов. Полная и авторитетная живёт в разделе «Роли и
 * доступы»; здесь — витрина на четыре строки, как в макете.
 */
const ROLE_MATRIX: Array<{ permission: string; allowed: [boolean, boolean, boolean, boolean] }> = [
  { permission: 'Открывать смену', allowed: [true, true, false, true] },
  { permission: 'Принимать технику', allowed: [false, true, false, true] },
  { permission: 'Закрывать дефекты', allowed: [false, false, true, true] },
  { permission: 'Изменять правила', allowed: [false, false, false, true] },
];

/** Ползунок веса: 60% — практический потолок одного критерия. */
const WEIGHT_SLIDER_MAX = 60;

const WEIGHT_SLIDER_CLASS = 'h-1.5 min-w-0 cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  + ' [&::-webkit-slider-thumb]:h-[13px] [&::-webkit-slider-thumb]:w-[13px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-signal-strong [&::-webkit-slider-thumb]:bg-background'
  + ' [&::-moz-range-thumb]:h-[13px] [&::-moz-range-thumb]:w-[13px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-signal-strong [&::-moz-range-thumb]:bg-background';

function RulesSettings(props: ReferenceUiProps) {
  const [draft, setDraft] = useState<ReadinessRuleSet>(
    props.rulesState.draft ?? props.rulesState.published,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = draft.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const rulesUnavailable = !props.rulesAvailable || !props.bootstrap?.capabilities.entities.rules.manage;
  const previewFacts = props.factsByEquipment[props.selectedId];
  const preview = previewFacts ? computeReadinessScore(previewFacts, draft) : null;
  const previewEquipment = props.equipment.find((item) => item.id === props.selectedId);
  const previewFleet = props.fleetCards.find((item) => item.id === props.selectedId);
  // Список правок показываем от действующей версии к тому, что сейчас в форме,
  // чтобы несохранённые изменения были видны до нажатия «Сохранить черновик».
  const pendingChanges = describeRuleSetChanges(props.rulesState.published, draft);
  const pending = pendingChanges.length;
  const activeRules = draft.blockers.filter((blocker) => blocker.isActive);
  // updatedBy хранит идентификатор, а не имя: без обратного поиска в списке
  // участников на экран попал бы сырой id.
  const publishedAuthor = props.bootstrap?.selectors.actors
    .find((actor) => actor.id === props.rulesState.published.updatedBy)?.name
    ?? (props.rulesState.publishedInDb ? 'не указан' : '—');

  const patchCriterion = (
    key: ReadinessRuleSet['criteria'][number]['key'],
    patch: Partial<ReadinessRuleSet['criteria'][number]>,
  ) => {
    if (saving || rulesUnavailable) return;
    setDraft((current) => ({
      ...current,
      criteria: normalizeWeights(current.criteria.map((criterion) =>
        criterion.key === key ? { ...criterion, ...patch } : criterion)),
    }));
    setDirty(true);
  };

  const patchBlocker = (
    condition: ReadinessRuleSet['blockers'][number]['condition'],
    patch: Partial<ReadinessRuleSet['blockers'][number]>,
  ) => {
    if (saving || rulesUnavailable) return;
    setDraft((current) => ({
      ...current,
      blockers: current.blockers.map((blocker) =>
        blocker.condition === condition ? { ...blocker, ...patch } : blocker),
    }));
    setDirty(true);
  };

  const saveDraft = async (): Promise<ReadinessRulesState | null> => {
    if (saving) return null;
    if (rulesUnavailable) {
      toast.error('Сначала восстановите загрузку действующих правил.');
      return null;
    }
    if (total !== 100) {
      toast.error('Сумма весов критериев должна быть равна 100%.');
      return null;
    }
    setSaving(true);
    try {
      const response = await authFetch('/api/readiness-rules', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(`save:${response.status}`);
      const next = await response.json() as ReadinessRulesState;
      props.onRulesStateChange(next);
      setDraft(next.draft ?? next.published);
      setDirty(false);
      toast.success('Черновик правил сохранён');
      return next;
    } catch (error) {
      const status = error instanceof Error ? error.message.split(':')[1] : '';
      toast.error(
        status === '403'
          ? 'Недостаточно прав для изменения правил готовности.'
          : status === '429'
            ? 'Слишком много запросов. Повторите сохранение через минуту.'
            : 'Не удалось сохранить правила. Изменения оставлены в форме — повторите попытку.',
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publishRules = async () => {
    if (saving) return;
    if (rulesUnavailable) {
      toast.error('Публикация недоступна, пока действующие правила не загружены.');
      return;
    }
    if (total !== 100) {
      toast.error('Перед публикацией сумма весов должна быть равна 100%.');
      return;
    }
    setSaving(true);
    try {
      if (dirty) {
        const saveResponse = await authFetch('/api/readiness-rules', {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
        if (!saveResponse.ok) throw new Error(`save:${saveResponse.status}`);
      }
      const response = await authFetch('/api/readiness-rules/publish', { method: 'POST' });
      if (!response.ok) throw new Error(`publish:${response.status}`);
      const next = await response.json() as ReadinessRulesState;
      props.onRulesStateChange(next);
      setDraft(next.published);
      setDirty(false);
      toast.success(`Правила ${next.published.version} опубликованы`);
    } catch (error) {
      const status = error instanceof Error ? error.message.split(':')[1] : '';
      toast.error(
        status === '403'
          ? 'Публикация доступна только администратору.'
          : status === '429'
            ? 'Слишком много запросов. Повторите публикацию через минуту.'
            : 'Не удалось опубликовать правила. Черновик не потерян.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenTitle heading="Правила готовности" subtitle="Вес критериев, блокеры и матрица доступов" actions={<Button variant="outline" onClick={() => props.onSettingsSectionChange('audit')}><History className="mr-2 h-4 w-4" />История изменений</Button>} />
      {rulesUnavailable && (
        <div role="alert" className="mb-3 flex flex-col gap-3 rounded-xl border border-signal/30 bg-signal/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-signal-strong">Редактирование правил временно заблокировано</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Действующая версия не загрузилась. Базовые значения показаны только для просмотра, чтобы не перезаписать актуальную конфигурацию.
            </p>
          </div>
          <Button type="button" variant="outline" disabled={props.loading} onClick={props.onRetry} className="shrink-0">
            {props.loading ? 'Проверяем…' : 'Повторить'}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
          <div className="border-b border-border p-3">
            <h2 className="text-lg font-bold">Вес критериев и критические блокеры</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold">Вес критериев</h3>
                <span className="text-xs text-muted-foreground">Итого <b className={cn('ml-1 rounded px-2 py-1 font-mono', total === 100 ? 'bg-success/10 text-success-strong' : 'bg-destructive/10 text-destructive-strong')}>{total}%</b></span>
              </div>
              <div className="mt-2 divide-y divide-border">
                {draft.criteria.map((criterion) => {
                  const meta = CRITERION_LABELS[criterion.key];
                  const Icon = CRITERION_ICONS[criterion.key];
                  return (
                    <div key={criterion.key} className="grid grid-cols-[32px_minmax(0,1fr)_54px_80px_44px] items-center gap-1.5 py-2">
                      <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-success/10 text-success-strong"><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{meta.title}</div>
                        <div className="truncate text-3xs text-muted-foreground">{meta.hint}</div>
                      </div>
                      <label className="flex h-8 items-center gap-0.5 rounded-md border border-border bg-background px-1.5 focus-within:ring-2 focus-within:ring-ring">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={criterion.weight}
                          disabled={saving || rulesUnavailable || criterion.locked}
                          onChange={(event) => patchCriterion(criterion.key, { weight: Number(event.target.value) })}
                          aria-label={`Вес критерия ${meta.title}`}
                          className="w-full min-w-0 border-none bg-transparent text-right font-mono text-xs font-bold outline-none disabled:text-muted-foreground"
                        />
                        <span className="text-3xs text-muted-foreground">%</span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max={WEIGHT_SLIDER_MAX}
                        value={criterion.weight}
                        disabled={saving || rulesUnavailable || criterion.locked}
                        onChange={(event) => patchCriterion(criterion.key, { weight: Number(event.target.value) })}
                        aria-label={`Ползунок веса ${meta.title}`}
                        // Трек рисуем сами: у Chrome незаполненная часть при accent-color
                        // получается почти чёрной, а по макету она светло-серая.
                        style={{ backgroundImage: `linear-gradient(to right, var(--signal) 0 ${criterion.weight / WEIGHT_SLIDER_MAX * 100}%, var(--muted) ${criterion.weight / WEIGHT_SLIDER_MAX * 100}% 100%)` }}
                        className={WEIGHT_SLIDER_CLASS}
                      />
                      <span className="flex items-center justify-end">
                        <Toggle
                          checked={criterion.locked}
                          icon={<Lock className="h-2.5 w-2.5" />}
                          onChange={saving || rulesUnavailable ? undefined : (locked) => patchCriterion(criterion.key, { locked })}
                          label={`Закрепить вес критерия ${meta.title}`}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 border-t border-border pt-2 text-2xs text-muted-foreground">
                Сумма весов автоматически нормируется до 100%. Закреплённый вес при этом не меняется.
              </p>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">Блокеры и предупреждения</h3>
                  <span className="text-xs text-muted-foreground">{draft.blockers.filter((item) => item.isActive).length} из {draft.blockers.length} активны</span>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_128px_44px] items-end gap-2 border-b border-border pb-1.5 text-3xs uppercase text-muted-foreground">
                  <span>Условие</span><span>Действие</span><span className="text-right">Активно</span>
                </div>
                {draft.blockers.map((blocker) => {
                  // Предупреждение не останавливает работу — не красим его как критическое.
                  const advisory = blocker.action === 'WARN_ONLY';
                  return (
                    <div key={blocker.condition} className="grid grid-cols-[minmax(0,1fr)_128px_44px] items-center gap-2 border-b border-border py-2 text-2xs last:border-b-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', blocker.isActive ? (advisory ? 'text-warning-strong' : 'text-destructive-strong') : 'text-muted-foreground')} />
                        <span className="leading-tight">{BLOCKER_LABELS[blocker.condition]}</span>
                      </span>
                      <select
                        value={blocker.action}
                        disabled={saving || rulesUnavailable}
                        onChange={(event) => patchBlocker(blocker.condition, { action: event.target.value as BlockerAction })}
                        aria-label={`Действие правила ${BLOCKER_LABELS[blocker.condition]}`}
                        className={cn('w-full min-w-0 rounded px-1 py-1 text-3xs', advisory
                          ? 'border border-warning/25 bg-warning/10 text-warning-strong'
                          : 'border border-destructive/25 bg-destructive/10 text-destructive-strong')}
                      >
                        {BLOCKER_ACTIONS.map((action) => <option key={action} value={action}>{BLOCKER_ACTION_LABELS[action]}</option>)}
                      </select>
                      <span className="flex justify-end">
                        <Toggle checked={blocker.isActive} onChange={saving || rulesUnavailable ? undefined : (isActive) => patchBlocker(blocker.condition, { isActive })} label={`Включить правило ${BLOCKER_LABELS[blocker.condition]}`} />
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border p-3">
                <h3 className="font-bold">Роли и доступы</h3>
                <div className="mt-2 grid min-w-[286px] grid-cols-[104px_repeat(4,minmax(0,1fr))] text-3xs font-semibold text-muted-foreground">
                  <span />{ROLE_COLUMNS.map((role) => <span key={role} className="truncate text-center">{role}</span>)}
                </div>
                {ROLE_MATRIX.map((row) => (
                  <div key={row.permission} className="grid min-w-[286px] grid-cols-[104px_repeat(4,minmax(0,1fr))] items-center border-t border-border py-1.5 text-2xs">
                    <span>{row.permission}</span>
                    {row.allowed.map((allowed, column) => (
                      <span key={ROLE_COLUMNS[column]} className="flex justify-center">
                        {allowed
                          ? <CheckCircle2 className="h-4 w-4 text-success-strong" aria-label="Разрешено" />
                          : <span className="text-muted-foreground" aria-label="Недоступно">—</span>}
                      </span>
                    ))}
                  </div>
                ))}
                <button type="button" onClick={() => props.onSettingsSectionChange('roles')} className="mt-2 flex items-center gap-1 text-2xs font-semibold text-signal-strong hover:underline">
                  Открыть полную матрицу <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </section>
        <aside className="space-y-3">
          <section className={cn(card, 'p-3')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded-md border px-2.5 py-1 font-mono text-sm font-bold', props.rulesState.publishedInDb
                ? 'border-success/25 bg-success/10 text-success-strong'
                : 'border-signal/25 bg-signal/10 text-signal-strong')}>
                {props.rulesState.published.version} {'·'} {props.rulesState.publishedInDb ? 'Опубликована' : 'Не опубликована'}
              </span>
              {props.rulesState.publishedInDb
                ? <span className="flex items-center gap-1 text-2xs font-semibold text-success-strong"><CheckCircle2 className="h-3.5 w-3.5" />Действует</span>
                : <span className="flex items-center gap-1 text-2xs font-semibold text-signal-strong"><AlertTriangle className="h-3.5 w-3.5" />Не применяется</span>}
            </div>
            <dl className="mt-3 space-y-1 text-2xs leading-relaxed text-muted-foreground">
              <div className="flex justify-between gap-2"><dt>Последнее изменение</dt><dd className="text-right font-semibold text-foreground">{props.rulesState.published.updatedAt ? formatDateTimeInTimezone(props.rulesState.published.updatedAt, props.bootstrap?.tenant.timezone) : 'базовые значения'}</dd></div>
              <div className="flex justify-between gap-2"><dt>Автор</dt><dd className="text-right font-semibold text-foreground">{publishedAuthor}</dd></div>
              <div className="flex justify-between gap-2"><dt>Установок затронуто</dt><dd className="text-right font-mono font-semibold text-foreground">{props.equipment.length}</dd></div>
            </dl>
            <h3 className="mt-3 text-xs font-bold">Что сейчас действует</h3>
            <ul className="mt-1.5 space-y-1.5">
              {activeRules.length === 0
                ? <li className="text-2xs text-muted-foreground">Ни одно правило не включено — запуск ничем не ограничен.</li>
                : activeRules.map((rule) => (
                  <li key={rule.condition} className="flex items-start gap-2 text-2xs leading-relaxed">
                    <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md', rule.action === 'WARN_ONLY' ? 'bg-warning/10 text-warning-strong' : 'bg-destructive/10 text-destructive-strong')}><AlertTriangle className="h-3 w-3" /></span>
                    <span><b className="font-semibold text-foreground">{BLOCKER_LABELS[rule.condition]}</b> — {BLOCKER_ACTION_LABELS[rule.action].toLowerCase()}</span>
                  </li>
                ))}
            </ul>
          </section>
          <section className="rounded-[14px] border border-signal/25 bg-signal/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold">{props.rulesState.publishedInDb ? 'Неопубликованные изменения' : 'Правила ещё не приняты'}</h3>
              {pending > 0 && <span className="rounded bg-signal/20 px-2 py-1 text-xs font-bold text-signal-strong">{pending}</span>}
            </div>
            <ul className="mt-2 space-y-1.5">
              {!props.rulesState.publishedInDb ? (
                <>
                  <li className="text-2xs leading-relaxed text-muted-foreground">Пока правила не приняты, готовность установок не рассчитывается.</li>
                  <li className="text-2xs leading-relaxed text-muted-foreground">Публикация закрепит показанные веса и блокеры как действующие.</li>
                </>
              ) : pendingChanges.length === 0 ? (
                <li className="text-2xs leading-relaxed text-muted-foreground">Черновик совпадает с действующей версией.</li>
              ) : pendingChanges.map((change) => (
                <li key={change} className="flex items-start gap-2 text-2xs leading-relaxed">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-strong" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
            <Button onClick={() => void publishRules()} disabled={saving || rulesUnavailable || (pending === 0 && props.rulesState.publishedInDb)} className="mt-3 h-9 w-full bg-signal-strong hover:bg-signal-strong">
              {props.rulesState.publishedInDb ? 'Опубликовать изменения' : 'Опубликовать правила'}
            </Button>
            <Button onClick={() => void saveDraft()} disabled={saving || rulesUnavailable || !dirty} variant="outline" className="mt-2 h-9 w-full">Сохранить черновик</Button>
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 p-2.5 text-3xs font-semibold leading-relaxed text-warning-strong">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              После публикации правила применятся ко всем новым сменам. Уже открытые смены досчитываются по прежней версии.
            </p>
          </section>
        </aside>
      </div>
      <section className={cn(card, 'mt-2 p-3')}>
        <h2 className="font-bold">Предпросмотр расчёта готовности</h2>
        <div className="mt-3 grid grid-cols-1 items-start gap-4 xl:grid-cols-[270px_minmax(0,1.5fr)_minmax(0,1fr)_200px]">
          <div className="flex items-center gap-3">
            <EquipmentPhoto cardData={previewFleet} name={previewEquipment?.name ?? ''} className="h-[74px] w-[68px] shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{previewEquipment?.name ?? 'Установка не выбрана'}</div>
              <div className="truncate text-xs text-muted-foreground">{previewFleet?.assignedSiteName || 'Объект не назначен'}</div>
            </div>
            <ReadinessRing value={preview?.score ?? null} size={74} />
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Расчёт по критериям</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {draft.criteria.map((criterion) => {
                const result = preview?.criteria.find((item) => item.key === criterion.key);
                const ratio = result?.ratio ?? 0;
                return (
                  <div key={criterion.key}>
                    <div title={CRITERION_LABELS[criterion.key].title} className="flex min-h-8 min-w-0 items-end break-words text-3xs font-semibold leading-tight text-muted-foreground">{CRITERION_LABELS[criterion.key].short}</div>
                    <div className="mt-1 font-mono text-sm font-bold">{result?.earned ?? 0} <span className="text-2xs font-semibold text-muted-foreground">/ {criterion.weight}</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <span className={cn('block h-full rounded-full', ratio >= 0.999 ? 'bg-success-strong' : ratio > 0 ? 'bg-signal-strong' : 'bg-destructive-strong')} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 6 : 3)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Блокеры</div>
            {preview && preview.blockers.length > 0 ? (
              <ul className="space-y-2">
                {preview.blockers.map((blocker) => {
                  const advisory = blocker.action === 'WARN_ONLY';
                  return (
                    <li key={blocker.condition} className={cn('flex items-start gap-2.5 rounded-lg border p-2.5', advisory ? 'border-warning/25 bg-warning/10' : 'border-destructive/25 bg-destructive/10')}>
                      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', advisory ? 'bg-warning/20 text-warning-strong' : 'bg-destructive/20 text-destructive-strong')}><AlertTriangle className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        <b className="text-xs font-bold">{blocker.label}</b>
                        <div className="mt-0.5 text-3xs leading-relaxed text-muted-foreground">{blocker.actionLabel}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-border p-2.5 text-2xs text-muted-foreground">{preview ? 'Ни одно правило не сработало.' : 'Выберите тестовую установку.'}</p>
            )}
          </div>
          <div>
            <label htmlFor="rules-preview-equipment" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Тестовая установка</label>
            <select
              id="rules-preview-equipment"
              value={props.selectedId}
              onChange={(event) => props.onSelect(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
            >
              {props.equipment.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Button type="button" variant="outline" disabled={props.loading} onClick={props.onRetry} className="mt-2 h-9 w-full">
              {props.loading ? 'Обновляем…' : 'Пересчитать по свежим данным'}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2.5 border-t border-border pt-3 text-xs text-muted-foreground">
          Результат
          <span className={cn('rounded-md px-2.5 py-1 text-xs font-bold', preview?.canStart
            ? 'bg-success/10 text-success-strong'
            : preview ? 'bg-destructive/10 text-destructive-strong' : 'bg-muted text-muted-foreground')}>
            {preview?.verdictLabel ?? 'выберите установку'}
          </span>
        </div>
      </section>
    </>
  );
}
