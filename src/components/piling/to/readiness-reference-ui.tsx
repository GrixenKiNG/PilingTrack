'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BookText,
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
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import {
  BLOCKER_ACTIONS,
  BLOCKER_ACTION_LABELS,
  BLOCKER_LABELS,
  CRITERION_LABELS,
  computeReadinessScore,
  normalizeWeights,
  type BlockerAction,
  type ReadinessFacts,
  type ReadinessRuleSet,
  type ReadinessRulesState,
  type ReadinessScoreResult,
} from '@/modules/readiness';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
import type { EquipmentReadiness, ReadinessStatus } from './readiness-model';
import type { CrewSummary, MaintenanceSummary } from './readiness-design-views';

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

const card = 'rounded-[14px] border border-slate-200 bg-white shadow-sm';
const muted = 'text-muted-foreground';
const COMPACT_KPI_GRID = cn(
  KPI_GRID,
  '[&>*]:!min-h-[84px] [&>*]:!rounded-[10px] [&>*]:!p-3 max-sm:!grid-cols-1',
);

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const escapeCell = (value: string | number | null | undefined) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(';')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

function ScreenTitle({
  heading,
  subtitle,
  actions,
}: {
  heading: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[58px] flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:py-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{heading}</h1>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
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
}: {
  icon: PilingIconName;
  label: string;
  value: React.ReactNode;
  detail?: string;
  alert?: boolean;
}) {
  return <KpiTile icon={icon} label={label} value={value} detail={detail} alert={alert} />;
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
        <header
          aria-label="Разделы модуля технической готовности"
          className="sticky top-0 z-20 flex h-12 w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden bg-primary px-2 text-white sm:px-4"
        >
          {VIEW_ITEMS.map((item) => {
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
        </header>
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
  const readiness = props.readinessByEquipment[selected.id];
  const scoreResult = props.scoresByEquipment[selected.id];
  const detail = props.details[selected.id];
  const fleetCard = props.fleetCards.find((item) => item.id === selected.id);
  const selectedJournal = [...(props.journals[selected.id] ?? [])].sort(
    (left, right) => new Date(right.completedAt || right.createdAt).getTime() - new Date(left.completedAt || left.createdAt).getTime(),
  );
  const blockers = scoreResult?.criticalBlockers
    ?? readiness?.evidence.filter((item) => item.state === 'block').length
    ?? 0;
  const warnings = scoreResult?.findings
    ?? readiness?.evidence.filter((item) => ['warning', 'missing'].includes(item.state)).length
    ?? 0;

  return (
    <div>
      <div className="grid min-h-0 grid-cols-1 gap-3 py-3 md:grid-cols-[260px_minmax(0,1fr)] xl:h-[calc(100vh-190px)] xl:min-h-[680px] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
        <div className="border-b border-border p-4">
          <div className={cn(muted, 'text-2xs')}>Выбранная установка</div>
          <div className="mt-3 flex gap-3">
            <EquipmentPhoto cardData={fleetCard} name={selected.name} className="h-24 w-24 shrink-0" priority />
            <div className="min-w-0">
              <h2 className="break-words text-xl font-extrabold">{selected.name}</h2>
              <div className="mt-2 text-2xs text-muted-foreground">Заводской №</div>
              <div className="text-xs font-semibold">{detail?.equipment?.serialNumber || '—'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Место базирования</div>
              <div className="text-xs font-semibold">{detail?.crew?.site?.name || 'Не назначено'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Наработка</div>
              <div className="text-xs font-semibold">{selected.engineHoursTotal != null ? `${selected.engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—'}</div>
            </div>
          </div>
        </div>
        <div className="border-b border-border p-4">
          <div className="text-2xs text-muted-foreground">Статус готовности</div>
          <div className="mt-2">{readiness && <StatusPill status={readiness.status} />}</div>
          <div className="mt-3 rounded-lg border border-signal bg-signal/10 p-3">
            <div className="text-2xs text-muted-foreground">Следующее действие</div>
            <div className="mt-2 font-bold">{readiness?.nextAction || 'Проверить данные'}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{readiness?.reason}</p>
            <Button asChild className="mt-3 h-10 w-full bg-signal-strong hover:bg-signal-strong">
              <Link href={readiness?.nextActionHref || '/admin/to'}>
                Перейти к действию <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
        <div className="p-4">
          <h3 className="font-bold">Чек-лист смены (5 шагов)</h3>
          <div className="mt-3 divide-y divide-border">
            {readiness?.evidence.map((evidence, index) => (
              <div key={evidence.key} className="flex items-center gap-3 py-2.5">
                <span className={cn('grid h-6 w-6 place-items-center rounded-full text-xs font-bold', evidence.state === 'pass' ? 'bg-success-strong text-white' : 'bg-signal-strong text-white')}>{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{evidence.label}</div>
                  <div
                    title={evidence.value}
                    className="line-clamp-2 break-words text-2xs text-muted-foreground"
                  >
                    {evidence.value}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="space-y-3">
        <section className={cn(card, 'p-5')}>
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <h2 className="font-bold">Готовность к работе (доказательная)</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-8">
                <ReadinessRing value={scoreResult?.score ?? readiness?.score ?? null} />
                <div>
                  <div className="text-xs text-muted-foreground">Итоговый балл готовности</div>
                  <div className="mt-1 font-mono text-2xl font-bold">{scoreResult?.score ?? readiness?.score ?? '—'} <span className="text-sm font-normal text-muted-foreground">/100</span></div>
                  <div className="mt-3 flex gap-4 text-xs">
                    <span>Критические блокеры <b className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive-strong">{blockers}</b></span>
                    <span>Замечания <b className="ml-1 rounded bg-signal/10 px-1.5 py-0.5 text-signal-strong">{warnings}</b></span>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-left text-xs text-muted-foreground sm:text-right">
              <div>Последнее обновление</div>
              <div className="mt-2 font-semibold text-muted-foreground">{selectedJournal[0] ? new Date(selectedJournal[0].completedAt || selectedJournal[0].createdAt).toLocaleString('ru-RU') : 'Записей ещё нет'}</div>
              <Button variant="outline" className="mt-3 h-9" onClick={() => props.onViewChange('reports')}><History className="mr-2 h-4 w-4" />История оценок</Button>
            </div>
          </div>
          <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            Правила {scoreResult?.ruleVersion ?? props.rulesState.published.version}. Результат: {scoreResult?.verdictLabel ?? 'проверить комплект доказательств'}.
          </div>
        </section>
        <section className={cn(card, 'overflow-hidden')}>
          <div className="p-4">
            <h2 className="font-bold">Цепочка состояния</h2>
            <div className="mt-4 flex items-center justify-between overflow-x-auto pb-2">
              {[
                ['Смена открыта', CheckCircle2],
                ['Осмотр', Search],
                ['Моточасы', Gauge],
                ['Допуск', ShieldCheck],
                ['Приёмка', User],
              ].map(([label, Icon], index) => (
                <div key={label as string} className="flex min-w-[118px] flex-1 items-center">
                  <div className="text-center">
                    <span className={cn('mx-auto grid h-10 w-10 place-items-center rounded-full border', index === 0 ? 'border-success bg-success-strong text-white' : index === 1 ? 'border-signal bg-signal-strong text-white' : 'border-border bg-muted text-muted-foreground')}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className={cn('mt-2 text-2xs', index === 1 ? 'font-semibold text-signal-strong' : 'text-muted-foreground')}>{label as string}</div>
                  </div>
                  {index < 4 && <div className="mx-3 h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="font-bold">Критическое замечание</h3>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3">
              <AlertTriangle className="h-7 w-7 text-destructive-strong" />
              <div className="flex-1">
                <div className="font-semibold">{readiness?.activeRecord?.title || scoreResult?.blockers[0]?.label || 'Критических замечаний не обнаружено'}</div>
                <div className="mt-1 text-xs text-muted-foreground">{scoreResult?.blockers[0]?.actionLabel || (blockers ? 'Устраните блокер до запуска установки.' : 'Открытых блокирующих записей нет.')}</div>
              </div>
              <span className="rounded border border-destructive px-2 py-1 text-xs text-destructive-strong">{blockers ? 'Критическое' : 'Нет блокеров'}</span>
            </div>
          </div>
          <div className="border-t border-border p-4">
            <h3 className="font-bold">Доказательства готовности</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-5">
              {readiness?.evidence.map((evidence) => (
                <div key={evidence.key} className="rounded-lg border border-border p-3">
                  <div className="text-xs font-semibold">{evidence.label}</div>
                  <div className="mt-3"><EvidenceState state={evidence.state} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-3 md:col-span-2 xl:col-span-1">
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача и приёмка</h2><span className="text-2xs text-muted-foreground">неизменяемый журнал</span></div>
          <div className="mt-4 space-y-5 border-l border-border pl-5">
            {['Передано диспетчеру', 'Просмотрено диспетчером', 'Запрошены доработки', 'Повторно передано', 'Принято диспетчером'].map((label, index) => {
              const event = selectedJournal[index];
              return (
              <div key={label} className="relative">
                <span className={cn('absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full', index === 0 ? 'bg-signal-strong' : 'bg-muted-foreground')} />
                <div className="text-xs font-semibold">{label}</div>
                <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">{event ? `${new Date(event.completedAt || event.createdAt).toLocaleString('ru-RU')} · ${event.title}` : 'Не зафиксировано'}</div>
              </div>
              );
            })}
          </div>
          <button type="button" onClick={() => props.onViewChange('reports')} className="mt-4 text-xs font-semibold text-signal-strong">Открыть полный журнал →</button>
        </section>
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Входящие (диспетчер)</h2><span className="text-xs text-muted-foreground">{props.equipment.length}</span></div>
          <div className="mt-3 space-y-3">
            {props.equipment.slice(0, 3).map((item) => {
              const itemState = props.readinessByEquipment[item.id];
              const itemFleet = props.fleetCards.find((cardItem) => cardItem.id === item.id);
              return (
                <button key={item.id} type="button" onClick={() => props.onSelect(item.id)} className="flex w-full gap-3 rounded-lg border border-border p-3 text-left hover:border-orange-300">
                  <EquipmentPhoto cardData={itemFleet} name={item.name} className="h-12 w-12 shrink-0" />
                  <div className="min-w-0"><div className="truncate text-xs font-bold">{item.name}</div><div className="mt-1 text-2xs text-muted-foreground">{props.details[item.id]?.crew?.site?.name || 'Объект не назначен'}</div>{itemState && <div className="mt-2"><StatusPill status={itemState.status} /></div>}</div>
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
  const filtered = props.equipment.filter((item) => `${item.name} ${item.model ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
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
            <Button variant="outline" onClick={() => downloadCsv('tech-readiness-fleet.csv', [
              ['Установка', 'Модель', 'Готовность', 'Статус', 'Моточасы'],
              ...filtered.map((item) => [
                item.name,
                item.model,
                props.readinessByEquipment[item.id]?.score,
                props.readinessByEquipment[item.id]?.status,
                item.engineHoursTotal,
              ]),
            ])}>↓ Экспорт</Button>
          </div>
        )}
      />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="equipment-rig" label="Всего" value={props.equipment.length} />
        <RefKpi icon="accepted" label="Готово" value={ready} />
        <RefKpi icon="risk" label="Требует внимания" value={attention} alert={attention > 0} />
        <RefKpi icon="defect" label="Недоступно" value={blocked} alert={blocked > 0} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[180px_minmax(0,1fr)_290px]">
        <aside className={cn(card, 'p-3')}>
          <h2 className="font-bold">Парк техники</h2>
          <div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск установки" className="h-9 bg-muted pl-9" /></div>
          <FilterGroup title="Статус готовности" rows={[['Все установки', props.equipment.length], ['Готово', ready], ['Требует внимания', attention], ['Недоступно', blocked]]} />
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
                      <div className="text-xs font-bold">{selectedReadiness.activeRecord.title}</div>
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

function FilterGroup({ title: groupTitle, rows }: { title: string; rows: Array<readonly [string, number]> }) {
  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold">{groupTitle}</h3>
      <div className="mt-2 space-y-1.5">
        {rows.map(([label, count], index) => <div key={label} className="flex items-center justify-between text-xs text-muted-foreground"><span><span className={cn('mr-2 inline-block h-2 w-2 rounded-full border', index === 0 ? 'border-signal bg-signal-strong' : 'border-border')} />{label}</span><b>{count}</b></div>)}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div><div className="text-3xs text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold text-foreground">{value}</div></div>;
}

function ShiftsScreen(props: ReferenceUiProps) {
  const activeCrews = props.crews.filter((crew) => crew.isActive);
  const ready = activeCrews.filter((crew) => crew.equipment && props.readinessByEquipment[crew.equipment.id]?.canOperate);
  const blocked = activeCrews.filter((crew) => crew.equipment && ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(props.readinessByEquipment[crew.equipment.id]?.status));
  const waiting = Math.max(0, activeCrews.length - ready.length - blocked.length);
  const hours = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'];

  return (
    <>
      <ScreenTitle
        heading="Смены"
        subtitle={`Сегодня, ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`}
        actions={<div className="flex flex-wrap items-center gap-2"><div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white"><button type="button" aria-pressed className="px-5 py-2 text-xs font-semibold">День</button><button type="button" disabled title="Недельный график появится после накопления смен" className="border-l border-slate-200 px-5 py-2 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50">Неделя</button></div><Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href={props.selectedId ? `/inspections/new?equipmentId=${props.selectedId}` : '/inspections/new'}>+ Открыть смену</Link></Button></div>}
      />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="shift-start" label="Смен сегодня" value={activeCrews.length} />
        <RefKpi icon="technical-readiness" label="Готовы к запуску" value={ready.length} />
        <RefKpi icon="operator" label="Ждут приёмки" value={waiting} alert={waiting > 0} />
        <RefKpi icon="defect" label="Заблокированы" value={blocked.length} alert={blocked.length > 0} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto p-3')}>
          <h2 className="font-bold">График смен</h2>
          <div className="mt-3 grid min-w-[760px] grid-cols-[220px_minmax(0,1fr)]">
            <div />
            <div className="grid grid-cols-9 px-2 text-3xs text-muted-foreground">{hours.map((hour) => <span key={hour}>{hour}</span>)}</div>
          </div>
          <div className="mt-2 min-w-[760px] divide-y divide-border">
            {activeCrews.length > 0 ? activeCrews.slice(0, 5).map((crew, index) => {
              const state = crew.equipment ? props.readinessByEquipment[crew.equipment.id] : null;
              const equipmentCard = crew.equipment ? props.fleetCards.find((item) => item.id === crew.equipment?.id) : undefined;
              const left = 3 + (index % 4) * 10;
              const width = 48 + (index % 3) * 8;
              return (
                <div key={crew.id} className="grid grid-cols-[220px_minmax(0,1fr)] items-center py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <EquipmentPhoto cardData={equipmentCard} name={crew.equipment?.name || crew.name} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1"><div className="truncate text-2xs font-semibold">{crew.equipment?.name || 'Техника не назначена'}</div><div className="mt-0.5 truncate text-3xs text-muted-foreground">{crew.site?.name || 'Объект не назначен'}</div><div className="truncate text-3xs text-muted-foreground">{crew.name}</div></div>
                    {state && <span className={cn('mr-2 shrink-0 rounded px-1.5 py-1 text-3xs font-semibold', state.canOperate ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{state.canOperate ? 'Готова' : 'Ожидает'}</span>}
                  </div>
                  <div className="relative h-7 rounded bg-muted">
                    <div className={cn('absolute top-0.5 h-6 rounded px-3 py-1 text-3xs font-semibold text-white', state?.canOperate ? 'bg-success-strong' : state && ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(state.status) ? 'bg-destructive-strong' : 'bg-signal-strong')} style={{ left: `${left}%`, width: `${width}%` }}>
                      График смены не задан
                    </div>
                    <div className="absolute bottom-[-8px] top-[-8px] left-[23%] w-px bg-signal-strong"><span className="absolute -top-5 -translate-x-1/2 rounded bg-signal-strong px-1.5 py-0.5 text-3xs text-white">сейчас</span></div>
                  </div>
                </div>
              );
            }) : <div className="col-span-2 py-16 text-center text-sm text-muted-foreground">Активные назначения бригад отсутствуют.</div>}
          </div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача смены</h2><span className="rounded border border-border px-2 py-1 text-3xs text-muted-foreground">3 действия</span></div>
          <div className="mt-2 space-y-2">
            {activeCrews.slice(0, 3).map((crew, index) => {
              const state = crew.equipment ? props.readinessByEquipment[crew.equipment.id] : null;
              const fleet = crew.equipment ? props.fleetCards.find((item) => item.id === crew.equipment?.id) : undefined;
              return (
                <div key={crew.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal' : 'border-border')}>
                  <div className="flex gap-2"><EquipmentPhoto cardData={fleet} name={crew.equipment?.name || crew.name} className="h-11 w-11 shrink-0" /><div className="min-w-0"><div className="truncate text-xs font-bold">{crew.equipment?.name || 'Без техники'}</div><div className="mt-1 truncate text-3xs text-muted-foreground">{crew.site?.name || 'Объект не назначен'} · {crew.name}</div></div></div>
                  {index === 0 && <div className="mt-2 line-clamp-2 text-3xs leading-relaxed text-muted-foreground">{state?.reason || 'Нет решения о готовности'}</div>}
                  {index < 2 ? <Button asChild variant={index === 0 ? 'default' : 'outline'} className={cn('mt-2 h-8 w-full text-2xs', index === 0 && 'bg-signal-strong hover:bg-signal-strong')}><Link href={index === 0 ? '/admin/maintenance' : crew.equipment ? `/inspections/new?equipmentId=${crew.equipment.id}` : '/inspections/new'}>{index === 0 ? 'Назначить механика' : 'Принять смену'}</Link></Button> : state && <div className="mt-2 flex items-center justify-between text-3xs text-muted-foreground"><span>Готовность</span><StatusPill status={state.status} /></div>}
                </div>
              );
            })}
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
    </>
  );
}

function PermitsScreen(props: ReferenceUiProps) {
  const states = Object.values(props.readinessByEquipment);
  const active = states.filter((item) => item.canOperate).length;
  const blocked = states.filter((item) => ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const pending = Math.max(0, props.equipment.length - active - blocked);
  const crewByEquipment = new Map(props.crews.flatMap((crew) => crew.isActive && crew.equipment ? [[crew.equipment.id, crew] as const] : []));

  return (
    <>
      <ScreenTitle heading="Наряд-допуски" subtitle="Проверка условий и разрешений на выполнение работ" actions={<div className="flex gap-2"><Button variant="outline" onClick={() => downloadCsv('work-permits.csv', [
        ['Установка', 'Готовность', 'Статус', 'Причина'],
        ...props.equipment.map((item) => [item.name, props.readinessByEquipment[item.id]?.score, props.readinessByEquipment[item.id]?.status, props.readinessByEquipment[item.id]?.reason]),
      ])}>Экспорт</Button><Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href={props.selectedId ? `/inspections/new?equipmentId=${props.selectedId}` : '/inspections/new'}>+ Создать наряд</Link></Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="documents" label="Всего нарядов" value={props.equipment.length} />
        <RefKpi icon="accepted" label="Действуют" value={active} />
        <RefKpi icon="history" label="На согласовании" value={pending} alert={pending > 0} />
        <RefKpi icon="defect" label="Заблокированы" value={blocked} alert={blocked > 0} />
      </section>
      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6 text-success-strong" /><h2 className="font-bold">Условия допуска подтверждены для {active} из {props.equipment.length} смен</h2></div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-border"><div className="bg-success-strong" style={{ width: `${props.equipment.length ? active / props.equipment.length * 100 : 0}%` }} /><div className="bg-signal-strong" style={{ width: `${props.equipment.length ? pending / props.equipment.length * 100 : 0}%` }} /><div className="flex-1 bg-destructive-strong" /></div>
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
          <div className="p-3"><h2 className="font-bold">Реестр нарядов-допусков</h2><div className="mt-2 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" /><Input placeholder="Номер, установка, объект" className="h-8 bg-muted pl-9 text-xs" /></div>{['Все', 'Действующие', 'На согласовании'].map((label, index) => <button key={label} type="button" className={cn('rounded border px-3 text-2xs', index === 0 ? 'border-info bg-info/10 text-info-strong' : 'border-border text-muted-foreground')}>{label}</button>)}</div></div>
          <div className="grid min-w-[760px] grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_18px] border-y border-border bg-muted px-3 py-2 text-3xs uppercase tracking-wide text-muted-foreground"><span>№ наряда</span><span>Установка</span><span>Объект</span><span>Смена</span><span>Действует до</span><span>Готовность</span><span>Статус</span><span /></div>
          <div className="max-h-[230px] min-w-[760px] divide-y divide-border overflow-y-auto">
            {props.equipment.map((item, index) => {
              const state = props.readinessByEquipment[item.id];
              const crew = crewByEquipment.get(item.id);
              const passed = state?.evidence.filter((entry) => entry.state === 'pass').length ?? 0;
              return (
                <div key={item.id} className={cn('grid grid-cols-[125px_minmax(120px,1.2fr)_minmax(110px,1fr)_70px_100px_80px_110px_18px] items-center px-3 py-2 text-2xs hover:bg-orange-50/30', index === 0 && 'bg-orange-50/70 ring-1 ring-inset ring-orange-200')}>
                  <span className="font-bold">НД-{new Date().getFullYear()}-{String(index + 1).padStart(4, '0')}</span><span>{item.name}</span><span>{crew?.site?.name || 'Не назначен'}</span><span>{crew?.name || '—'}</span><span>Не установлен</span><span><b className="text-signal-strong">{passed} из 5</b></span><span>{state && <StatusPill status={state.status} />}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              );
            })}
          </div>
        </section>
        <aside className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Ожидают согласования</h2><span className="text-xs text-muted-foreground">{pending}</span></div>
          <div className="mt-2 space-y-2">{props.equipment.filter((item) => !props.readinessByEquipment[item.id]?.canOperate).slice(0, 2).map((item, index) => <div key={item.id} className={cn('rounded-lg border p-2.5', index === 0 ? 'border-signal' : 'border-border')}><div className="text-xs font-bold">НД-{new Date().getFullYear()}-{String(index + 1).padStart(4, '0')}</div><div className="mt-1 text-3xs text-muted-foreground">{item.name}</div><div className="mt-1 line-clamp-2 text-3xs text-destructive-strong">⚠ {props.readinessByEquipment[item.id]?.reason}</div></div>)}</div>
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
    </>
  );
}

function MaintenanceScreen(props: ReferenceUiProps) {
  const open = props.maintenance.filter((record) => !['DONE', 'CANCELLED'].includes(record.status));
  const critical = open.filter((record) => ['CRITICAL', 'HIGH'].includes(record.priority));
  const planned = open.filter((record) => ['PLANNED', 'ASSIGNED'].includes(record.status));
  const servicePercent = props.equipment.length ? Math.round(((props.equipment.length - critical.length) / props.equipment.length) * 100) : 0;

  return (
    <>
      <ScreenTitle heading="Обслуживание" subtitle="Техническое состояние и план работ" actions={<div className="flex flex-wrap gap-2"><select className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs"><option>Все установки</option></select><select className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs"><option>Сегодня</option></select><Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/maintenance">+ Создать заявку</Link></Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="defect" label="Критические дефекты" value={critical.length} alert={critical.length > 0} />
        <RefKpi icon="work-order" label="Работы сегодня" value={open.length} />
        <RefKpi icon="maintenance-due" label="Ближайшие ТО" value={planned.length} />
        <RefKpi icon="technical-readiness" label="Готовность сервиса" value={`${Math.max(0, servicePercent)}%`} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className={cn(card, 'p-3')}>
          <h2 className="font-bold">Заявки и работы</h2>
          <div className="mt-3 flex flex-wrap gap-2">{['Все', 'Критические', 'В работе', 'Плановые'].map((label, index) => <button key={label} type="button" className={cn('h-8 rounded border px-3 text-xs', index === 0 ? 'border-signal text-signal-strong' : 'border-border text-muted-foreground')}>{label}</button>)}<div className="relative min-w-[220px] flex-1 xl:ml-auto xl:max-w-64"><Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" /><Input placeholder="Поиск по технике или заявке" className="h-8 bg-muted pl-9 text-xs" /></div></div>
          <div className="mt-2 max-h-[364px] space-y-2 overflow-y-auto pr-1">
            {props.maintenance.length > 0 ? props.maintenance.slice(0, 8).map((record, index) => {
              const fleet = record.equipment ? props.fleetCards.find((item) => item.id === record.equipment?.id) : undefined;
              const criticalRecord = ['CRITICAL', 'HIGH'].includes(record.priority);
              return (
                <article key={record.id} className={cn('flex min-h-[86px] flex-wrap items-center gap-3 rounded-lg border-l-[3px] p-2.5 sm:flex-nowrap', criticalRecord ? 'border-y border-r border-destructive/25 border-l-destructive bg-destructive/10' : index % 2 ? 'border-y border-r border-info/25 border-l-info bg-info/10' : 'border-y border-r border-signal/25 border-l-signal bg-signal/10')}>
                  <EquipmentPhoto cardData={fleet} name={record.equipment?.name || record.title} className="h-14 w-14 shrink-0" />
                  <span className={cn('grid h-9 w-9 place-items-center rounded-full', criticalRecord ? 'bg-destructive/10 text-destructive-strong' : 'bg-white text-signal-strong')}>{criticalRecord ? <AlertTriangle className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}</span>
                  <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{record.title}</h3><div className="mt-0.5 text-2xs text-muted-foreground">{record.equipment?.name || 'Установка не указана'}</div><div className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">{record.description || 'Описание не заполнено'}</div><div className="mt-1 text-3xs text-muted-foreground">▣ {record.scheduledAt ? new Date(record.scheduledAt).toLocaleString('ru-RU') : 'Срок не задан'}</div></div>
                  <div className="w-full text-left text-2xs sm:w-36 sm:text-right"><div className={cn('font-semibold', criticalRecord ? 'text-destructive-strong' : 'text-info-strong')}>{criticalRecord ? 'Критическое' : record.status}</div><div className="mt-1 text-muted-foreground">Приоритет · <b className="text-muted-foreground">{record.priority}</b></div><Button asChild className="mt-2 h-8 bg-signal-strong text-2xs hover:bg-signal-strong"><Link href={`/admin/maintenance/${record.id}`}>Открыть заявку</Link></Button></div>
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
  const states = Object.values(props.readinessByEquipment);
  const ready = states.filter((item) => item.canOperate).length;
  const blocked = states.filter((item) => ['IN_REPAIR', 'BLOCKED', 'OVERDUE'].includes(item.status)).length;
  const readinessPercent = states.length ? Math.round(ready / states.length * 1000) / 10 : 0;
  const allRecords = Object.values(props.journals).flat();
  const journalRows = Object.entries(props.journals).flatMap(([equipmentId, records]) => records.map((record) => ({
    ...record,
    equipmentName: props.equipment.find((item) => item.id === equipmentId)?.name || 'Установка',
  })));
  const completed = allRecords.filter((record) => record.status === 'DONE').length;
  const blockerRows = [
    ['Ремонт и дефекты', blocked],
    ['Осмотр', states.filter((item) => item.evidence.find((e) => e.key === 'inspection')?.state !== 'pass').length],
    ['Экипаж', states.filter((item) => item.evidence.find((e) => e.key === 'crew')?.state !== 'pass').length],
    ['Документы', states.filter((item) => item.evidence.find((e) => e.key === 'maintenance')?.state !== 'pass').length],
  ] as const;
  const maxBlocker = Math.max(1, ...blockerRows.map(([, value]) => value));

  return (
    <>
      <ScreenTitle heading="Отчёты" subtitle="Аналитика доказательной готовности" actions={<div className="flex flex-wrap gap-2"><span className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs">▣ Текущий срез · {new Date().toLocaleDateString('ru-RU')}</span><Button className="bg-signal-strong hover:bg-signal-strong" onClick={() => downloadCsv('readiness-report.csv', [['Дата', 'Установка', 'Событие', 'Тип', 'Статус'], ...journalRows.map((record) => [record.completedAt || record.createdAt, record.equipmentName, record.title, record.type, record.status])])}>Экспорт</Button></div>} />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(5)}>
        <RefKpi icon="technical-readiness" label="Готовность парка" value={`${readinessPercent}%`} detail="текущий срез" />
        <RefKpi icon="shift-start" label="Смен допущено" value={ready} detail="по текущим доказательствам" />
        <RefKpi icon="defect" label="Заблокировано" value={blocked} alert={blocked > 0} />
        <RefKpi icon="history" label="Среднее решение" value="—" detail="нет истории решений" />
        <RefKpi icon="documents" label="Доказательств" value={completed} detail={`из ${allRecords.length} записей`} />
      </section>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <section className={cn(card, 'p-3')}>
          <div className="flex items-center justify-between"><h2 className="font-bold">Динамика готовности за 30 дней</h2><div className="flex overflow-hidden rounded border border-border"><button className="bg-signal-strong px-3 py-1.5 text-xs text-white">День</button><button className="px-3 py-1.5 text-xs">Неделя</button></div></div>
          <div className="relative mt-3 h-[150px] border-b border-l border-border">
            {[0, 1, 2, 3].map((line) => <div key={line} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${line * 33}%` }} />)}
            <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"><defs><linearGradient id="readyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--signal)" stopOpacity=".18" /><stop offset="100%" stopColor="var(--signal)" stopOpacity="0" /></linearGradient></defs><path d="M0 75 L45 68 L90 78 L135 55 L180 82 L225 64 L270 90 L315 110 L360 74 L405 82 L450 62 L495 76 L540 60 L600 72 L600 200 L0 200 Z" fill="url(#readyFill)" /><path d="M0 75 L45 68 L90 78 L135 55 L180 82 L225 64 L270 90 L315 110 L360 74 L405 82 L450 62 L495 76 L540 60 L600 72" fill="none" stroke="var(--signal)" strokeWidth="3" /></svg>
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
        <div className="grid min-w-[760px] grid-cols-[160px_190px_minmax(0,1fr)_150px_120px] border-y border-border bg-muted px-4 py-2 text-3xs uppercase tracking-wide text-muted-foreground"><span>Дата и время</span><span>Установка</span><span>Событие</span><span>Тип</span><span>Статус</span></div>
        <div className="min-w-[760px] divide-y divide-border">
          {journalRows.length > 0 ? journalRows.slice(0, 4).map((record) => (
            <div key={record.id} className="grid grid-cols-[160px_190px_minmax(0,1fr)_150px_120px] items-center px-4 py-2 text-2xs">
              <span className="text-muted-foreground">{new Date(record.completedAt || record.createdAt).toLocaleString('ru-RU')}</span>
              <span className="font-semibold">{record.equipmentName}</span>
              <span className="truncate">{record.title}</span>
              <span className="text-muted-foreground">{record.type}</span>
              <span><span className={cn('rounded px-2 py-1 text-3xs font-semibold', record.status === 'DONE' ? 'bg-success/10 text-success-strong' : 'bg-signal/10 text-signal-strong')}>{record.status}</span></span>
            </div>
          )) : <div className="py-10 text-center text-sm text-muted-foreground">Записи доказательного журнала отсутствуют.</div>}
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
    <div className="grid min-h-[calc(100vh-48px)] grid-cols-1 xl:grid-cols-[180px_minmax(0,1fr)]">
      <aside className="sticky top-12 z-20 border-b border-border bg-white px-2 py-2 xl:static xl:border-b-0 xl:border-r xl:px-3 xl:py-4">
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
                  'flex h-9 shrink-0 items-center gap-2.5 border-l-2 px-3 text-left text-xs transition xl:w-full',
                  props.settingsSection === item.id
                    ? 'border-signal bg-signal/10 font-semibold text-signal-strong'
                    : 'border-transparent text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 px-2 sm:px-4">
        {props.settingsSection === 'rules' && (
          <RulesSettings
            key={`${props.rulesState.published.version}:${props.rulesState.draft?.updatedAt ?? 'published'}`}
            {...props}
          />
        )}
        {props.settingsSection === 'checklists' && <ChecklistsSettings {...props} />}
        {props.settingsSection === 'roles' && <RolesSettings {...props} />}
        {props.settingsSection === 'dictionaries' && <DictionariesSettings {...props} />}
        {props.settingsSection === 'notifications' && <NotificationsSettings />}
        {props.settingsSection === 'integrations' && <IntegrationsSettings {...props} />}
        {props.settingsSection === 'audit' && <AuditSettings {...props} />}
      </main>
    </div>
  );
}

function SettingsKpis({ items }: { items: Array<{ icon: PilingIconName; label: string; value: React.ReactNode; alert?: boolean }> }) {
  return (
    <section className={COMPACT_KPI_GRID} style={kpiGridStyle(items.length)}>
      {items.map((item) => <RefKpi key={item.label} {...item} />)}
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange?: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={!onChange} onClick={() => onChange?.(!checked)} className={cn('relative h-5 w-9 rounded-full transition disabled:cursor-not-allowed', checked ? 'bg-success-strong' : 'bg-border')}>
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function RulesSettings(props: ReferenceUiProps) {
  const [draft, setDraft] = useState<ReadinessRuleSet>(
    props.rulesState.draft ?? props.rulesState.published,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = draft.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const rulesUnavailable = !props.rulesAvailable;
  const previewFacts = props.factsByEquipment[props.selectedId];
  const preview = previewFacts ? computeReadinessScore(previewFacts, draft) : null;
  const pending = props.rulesState.pendingChanges + (dirty ? 1 : 0);

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
      <ScreenTitle heading="Настройки системы" subtitle="Правила, доступы и конфигурация готовности" actions={<Button variant="outline"><History className="mr-2 h-4 w-4" />История изменений</Button>} />
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
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <section className={cn(card, 'overflow-hidden')}>
            <div className="border-b border-border p-3"><h2 className="text-lg font-bold">Правила готовности</h2><p className="mt-0.5 text-2xs text-muted-foreground">Вес критериев и критические блокеры</p></div>
            <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between"><h3 className="font-bold">Вес критериев</h3><span className="text-xs text-muted-foreground">Итого <b className={cn('ml-2 rounded px-2 py-1', total === 100 ? 'bg-success/10 text-success-strong' : 'bg-destructive/10 text-destructive-strong')}>{total}%</b></span></div>
                <p className="mt-1 text-xs text-muted-foreground">Перетащите, чтобы изменить приоритет</p>
                <div className="mt-2 divide-y divide-border">
                  {draft.criteria.map((criterion) => {
                    const meta = CRITERION_LABELS[criterion.key];
                    return (
                      <div key={criterion.key} className="grid grid-cols-[minmax(0,1fr)_48px_76px_38px] items-center gap-2 py-2">
                        <div className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-muted-foreground" /><div><div className="text-xs font-semibold">{meta.title}</div><div className="text-3xs text-muted-foreground">{meta.hint}</div></div></div>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={criterion.weight}
                          disabled={saving || rulesUnavailable || criterion.locked}
                          onChange={(event) => patchCriterion(criterion.key, { weight: Number(event.target.value) })}
                          aria-label={`Вес критерия ${meta.title}`}
                          className="h-8 rounded border border-border px-2 text-right text-xs disabled:bg-muted"
                        />
                        <input
                          type="range"
                          min="0"
                          max="50"
                          value={criterion.weight}
                          disabled={saving || rulesUnavailable || criterion.locked}
                          onChange={(event) => patchCriterion(criterion.key, { weight: Number(event.target.value) })}
                          aria-label={`Ползунок веса ${meta.title}`}
                          className="accent-signal disabled:opacity-50"
                        />
                        <span className="flex items-center gap-1">
                          <Toggle checked={criterion.locked} onChange={saving || rulesUnavailable ? undefined : (locked) => patchCriterion(criterion.key, { locked })} />
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between"><h3 className="font-bold">Критические блокеры</h3><span className="text-xs text-muted-foreground">{draft.blockers.filter((item) => item.isActive).length} из {draft.blockers.length} активны</span></div>
                  <div className="mt-2 grid grid-cols-[1fr_150px_36px] border-b border-border pb-2 text-3xs uppercase text-muted-foreground"><span>Условие</span><span>Действие</span><span /></div>
                  {draft.blockers.map((blocker) => (
                    <div key={blocker.condition} className="grid grid-cols-[1fr_150px_36px] items-center border-b border-border py-2 text-2xs">
                      <span className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-destructive-strong" />{BLOCKER_LABELS[blocker.condition]}</span>
                      <select
                        value={blocker.action}
                        disabled={saving || rulesUnavailable}
                        onChange={(event) => patchBlocker(blocker.condition, { action: event.target.value as BlockerAction })}
                        aria-label={`Действие блокера ${BLOCKER_LABELS[blocker.condition]}`}
                        className="mr-2 w-[142px] min-w-0 rounded border border-destructive/25 bg-destructive/10 px-1 py-1 text-3xs text-destructive-strong"
                      >
                        {BLOCKER_ACTIONS.map((action) => <option key={action} value={action}>{BLOCKER_ACTION_LABELS[action]}</option>)}
                      </select>
                      <Toggle checked={blocker.isActive} onChange={saving || rulesUnavailable ? undefined : (isActive) => patchBlocker(blocker.condition, { isActive })} />
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-xl border border-border p-3"><h3 className="font-bold">Роли и доступы</h3><div className="mt-2 grid min-w-[420px] grid-cols-[1fr_repeat(4,60px)] text-3xs uppercase text-muted-foreground"><span /><span>Оператор</span><span>Диспетчер</span><span>Механик</span><span>Админ</span></div>{['Открывать смену', 'Принимать технику', 'Закрывать дефекты', 'Изменять правила'].map((permission, row) => <div key={permission} className="grid min-w-[420px] grid-cols-[1fr_repeat(4,60px)] items-center border-t border-border py-1.5 text-2xs"><span>{permission}</span>{[0, 1, 2, 3].map((column) => <span key={column} className="text-center">{column === 3 || (row < 2 && column < 2) || (row === 2 && column === 2) ? '✓' : '—'}</span>)}</div>)}</div>
              </div>
            </div>
          </section>
        </div>
        <aside className="space-y-3">
          <section className={cn(card, 'p-3')}><div className="rounded bg-success/10 px-3 py-2 text-sm font-bold text-success-strong">{props.rulesState.published.version} · Опубликована</div><div className="mt-2 text-2xs leading-relaxed text-muted-foreground">Последнее изменение: {props.rulesState.published.updatedAt ? new Date(props.rulesState.published.updatedAt).toLocaleString('ru-RU') : 'базовые правила'}<br />Установок затронуто: {props.equipment.length}</div></section>
          <section className={cn(card, 'p-3')}><h3 className="font-bold">Действующая версия</h3><ul className="mt-2 space-y-1.5 text-2xs text-muted-foreground"><li>✓ Пять взвешенных критериев</li><li>✓ Версионирование публикаций</li><li>✓ Критические блокировки запуска</li></ul></section>
          <section className="rounded-[14px] border border-signal/25 bg-signal/10 p-3"><div className="flex items-center justify-between"><h3 className="font-bold">Неопубликованные изменения</h3><span className="rounded bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive-strong">{pending}</span></div><ul className="mt-2 space-y-1.5 text-2xs text-muted-foreground"><li>• Изменения сохраняются как черновик</li><li>• После публикации создаётся новая версия</li></ul><Button onClick={() => void publishRules()} disabled={saving || rulesUnavailable || pending === 0} className="mt-3 h-9 w-full bg-signal-strong hover:bg-signal-strong">Опубликовать</Button><Button onClick={() => void saveDraft()} disabled={saving || rulesUnavailable || !dirty} variant="outline" className="mt-2 h-9 w-full">Сохранить черновик</Button></section>
        </aside>
      </div>
      <section className={cn(card, 'mt-2 p-3')}>
        <h2 className="font-bold">Предпросмотр расчёта готовности</h2>
        <div className="mt-2 flex items-center gap-5">
          <ReadinessRing value={preview?.score ?? null} size={88} />
          <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-5">
            {draft.criteria.map((criterion) => {
              const result = preview?.criteria.find((item) => item.key === criterion.key);
              return <div key={criterion.key} className="rounded-lg border border-border p-2 text-center"><div className="text-3xs font-semibold">{CRITERION_LABELS[criterion.key].title}</div><div className="mt-1 font-mono text-base font-bold">{result?.earned ?? 0}/{criterion.weight}</div></div>;
            })}
          </div>
          <div className="w-44 rounded-lg border border-border p-3 text-xs text-muted-foreground">Результат:<br /><b className="mt-1 block text-destructive-strong">{preview?.verdictLabel ?? 'выберите установку'}</b></div>
        </div>
      </section>
    </>
  );
}

function ChecklistsSettings(props: ReferenceUiProps) {
  const templates = ['Ежесменный осмотр', 'Закрытие смены', 'ТО-500', 'Приёмка ремонта', 'Осмотр молота'];
  const rows = [
    ['Осмотреть рукава и соединения', 'Да / Нет', true, true],
    ['Проверить уровень гидравлического масла', 'Да / Нет', true, false],
    ['Проверить наличие подтеканий', 'Да / Нет', true, true],
    ['Температура масла после запуска', 'Число (°C)', true, false],
  ] as const;
  return (
    <>
      <ScreenTitle heading="Чек-листы" subtitle="Конструктор проверок для смены, техники и обслуживания" actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/checklists/new">+ Создать шаблон</Link></Button>} />
      <SettingsKpis items={[{ icon: 'inspection', label: 'Всего шаблонов', value: templates.length }, { icon: 'accepted', label: 'Опубликовано', value: 4 }, { icon: 'documents', label: 'Черновики', value: 1 }, { icon: 'history', label: 'Требуют обновления', value: props.equipment.length ? 1 : 0 }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[184px_minmax(0,1fr)_240px]">
        <aside className={cn(card, 'overflow-hidden')}><div className="p-3"><h2 className="font-bold">Шаблоны чек-листов</h2><div className="relative mt-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Поиск по шаблонам" className="h-9 pl-9 text-xs" /></div></div><div>{templates.map((template, index) => <button key={template} type="button" className={cn('w-full border-t border-border p-3 text-left', index === 0 && 'border-l-2 border-l-signal bg-signal/10')}><div className={cn('text-xs font-semibold', index === 0 && 'text-signal-strong')}>{template}</div><div className="mt-1 text-3xs text-muted-foreground">v{index + 1}.2 · Опубликован</div></button>)}</div></aside>
        <section className={cn(card, 'overflow-x-auto p-4')}>
          <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Ежесменный осмотр сваебойной установки <span className="font-normal text-muted-foreground">v3.2</span></h2><span className="mt-2 inline-flex rounded bg-success/10 px-2 py-1 text-xs text-success-strong">Опубликован</span></div><div className="flex gap-2"><Button variant="outline">••• Ещё</Button><Button variant="outline">◉ Предпросмотр</Button></div></div>
          <div className="mt-4 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between"><div><h3 className="font-bold">Гидравлическая система</h3><div className="mt-1 text-xs text-muted-foreground">Проверьте состояние гидравлических компонентов установки.</div></div><Button variant="outline">+ Добавить пункт</Button></div>
            <div className="mt-4 grid min-w-[680px] grid-cols-[40px_minmax(0,1fr)_90px_92px_70px] gap-2 border-b border-border pb-2 text-3xs uppercase text-muted-foreground"><span>№</span><span>Пункт проверки</span><span>Тип ответа</span><span>Обязат.</span><span>Блокер</span></div>
            {rows.map(([name, answer, required, blocker], index) => <div key={name} className="grid min-w-[680px] grid-cols-[40px_minmax(0,1fr)_90px_92px_70px] items-center gap-2 border-b border-border py-3 text-xs"><span className="rounded border border-border p-2 text-center font-bold">{index + 1}</span><span className="rounded border border-border p-2">{name}</span><span className="rounded border border-border p-2">{answer}</span><span>{required && <span className="rounded bg-signal/10 px-1.5 py-1 text-3xs text-signal-strong">Обязательно</span>}</span><span>{blocker && <span className="rounded bg-destructive/10 px-2 py-1 text-destructive-strong">Блокер</span>}</span></div>)}
          </div>
        </section>
        <aside className={cn(card, 'p-4')}><div className="flex items-center justify-between"><h2 className="font-bold">Настройки пункта</h2><span>×</span></div><label className="mt-4 block text-2xs text-muted-foreground">Текст пункта<textarea className="mt-2 h-20 w-full rounded-lg border border-border p-3 text-xs" defaultValue="Осмотреть рукава и соединения" /></label><label className="mt-4 block text-2xs text-muted-foreground">Описание (необязательно)<textarea className="mt-2 h-20 w-full rounded-lg border border-border p-3 text-xs" placeholder="Дополнительные пояснения для оператора" /></label><label className="mt-4 block text-2xs text-muted-foreground">Тип ответа<select className="mt-2 h-10 w-full rounded-lg border border-border px-3 text-xs"><option>Да / Нет</option></select></label><div className="mt-5 space-y-3 text-xs">{['Обязательный ответ', 'Требовать фото', 'Создавать дефект при «Нет»'].map((label) => <div key={label} className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0">{label}</span><span className="shrink-0"><Toggle checked /></span></div>)}</div></aside>
      </div>
    </>
  );
}

function RolesSettings(props: ReferenceUiProps) {
  const roles = ['Оператор', 'Диспетчер', 'Механик', 'Мастер', 'Инженер ОТ', 'Администратор'];
  const permissions = ['Открывать смену', 'Принимать технику', 'Закрывать дефекты', 'Подтверждать наряд-допуск', 'Изменять правила', 'Экспортировать отчёты'];
  const users = props.crews.flatMap((crew) => [crew.operator?.name, ...crew.assistants.map((assistant) => assistant.name)]).filter(Boolean);
  return (
    <>
      <ScreenTitle heading="Роли и доступы" subtitle="Полномочия пользователей, контур объектов и временные замещения" actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/users">+ Добавить пользователя</Link></Button>} />
      <SettingsKpis items={[{ icon: 'crew', label: 'Пользователи', value: users.length }, { icon: 'accepted', label: 'Активные', value: users.length }, { icon: 'operator', label: 'Вне системы', value: 0 }, { icon: 'risk', label: 'Требуют внимания', value: 0 }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto p-4')}><h2 className="font-bold">Матрица полномочий</h2><div className="mt-4 min-w-[760px] overflow-hidden rounded-lg border border-border"><div className="grid grid-cols-[210px_repeat(6,1fr)] bg-muted text-center text-3xs text-muted-foreground"><span className="p-3" />{roles.map((role) => <span key={role} className="border-l border-border p-3">{role}</span>)}</div>{permissions.map((permission, row) => <div key={permission} className="grid grid-cols-[210px_repeat(6,1fr)] border-t border-border text-xs"><span className="p-3">{permission}</span>{roles.map((role, column) => <span key={role} className="grid place-items-center border-l border-border p-3">{column === 5 || (row < 2 && column < 2) || (row === 2 && column === 2) ? <span className="grid h-6 w-6 place-items-center rounded-full bg-success-strong text-white">✓</span> : <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-muted-foreground">—</span>}</span>)}</div>)}</div></section>
        <aside className="space-y-3"><section className={cn(card, 'p-4')}><h2 className="font-bold">Роли</h2><div className="mt-3 divide-y divide-border">{roles.map((role, index) => <div key={role} className="flex items-center gap-3 py-3 text-xs"><ShieldCheck className={cn('h-4 w-4', index === 0 ? 'text-info-strong' : 'text-muted-foreground')} />{role}</div>)}</div></section><section className={cn(card, 'p-4')}><h2 className="font-bold">Пользователи роли</h2><div className="mt-3 space-y-2">{users.slice(0, 6).map((name) => <div key={name as string} className="flex items-center justify-between rounded-lg border border-border p-3 text-xs"><span>{name as string}</span><span className="rounded bg-success/10 px-2 py-1 text-success-strong">Активен</span></div>)}</div></section></aside>
      </div>
    </>
  );
}

function DictionariesSettings(props: ReferenceUiProps) {
  const categories = ['Техника', 'Объекты и площадки', 'Типы работ', 'Причины простоев', 'Дефекты и узлы', 'Документы и допуски', 'Единицы измерения'];
  return (
    <>
      <ScreenTitle heading="Справочники" subtitle="Единые нормативные данные для техники, объектов и отчётности" actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/dictionaries">+ Добавить запись</Link></Button>} />
      <SettingsKpis items={[{ icon: 'documents', label: 'Справочников', value: categories.length }, { icon: 'reports', label: 'Записей', value: props.equipment.length }, { icon: 'history', label: 'Черновиков', value: 0 }, { icon: 'risk', label: 'Конфликтов', value: 0 }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto')}>
          <div className="p-4"><h2 className="font-bold">Справочник «Техника»</h2><div className="mt-3 flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Поиск по наименованию, типу или №" className="h-9 pl-9 text-xs" /></div><button className="h-9 rounded-lg border border-border px-3 text-xs">Тип: Все</button><button className="h-9 rounded-lg border border-border px-3 text-xs">Статус: Все</button><Button asChild variant="outline" className="h-9 text-success-strong"><Link href="/admin/dictionaries">Импорт XLSX</Link></Button><Button variant="outline" className="h-9" onClick={() => downloadCsv('equipment-dictionary.csv', [['Наименование', 'Тип', 'Заводской №', 'Норматив ТО'], ...props.equipment.map((item) => [item.name, item.model, props.details[item.id]?.equipment?.serialNumber, item.nextMaintenanceAtHours])])}>Экспорт</Button></div></div>
          <div className="grid min-w-[760px] grid-cols-[1.3fr_1fr_1fr_0.8fr_0.7fr_20px] border-y border-border px-4 py-2 text-3xs uppercase text-muted-foreground"><span>Наименование</span><span>Тип</span><span>Заводской №</span><span>Норматив ТО</span><span>Используется</span><span /></div>
          <div className="min-w-[760px] divide-y divide-border">{props.equipment.map((item) => <div key={item.id} className="grid grid-cols-[1.3fr_1fr_1fr_0.8fr_0.7fr_20px] items-center px-4 py-3 text-xs hover:bg-signal/5"><span className="font-semibold">{item.name}</span><span>{item.model || 'Установка'}</span><span>{props.details[item.id]?.equipment?.serialNumber || '—'}</span><span>{item.nextMaintenanceAtHours != null ? `${item.nextMaintenanceAtHours.toLocaleString('ru-RU')} м/ч` : '—'}</span><span className="text-success-strong">◉ Да</span><span>⋮</span></div>)}</div>
          <div className="flex items-center justify-between border-t border-border p-4 text-xs text-muted-foreground"><span>Показывать по: <b className="rounded border border-border px-3 py-2">25⌄</b></span><span>1–{props.equipment.length} из {props.equipment.length} ›</span></div>
        </section>
        <aside className={cn(card, 'overflow-hidden')}><div className="p-4"><h2 className="font-bold">Категории справочников</h2></div>{categories.map((category, index) => <button key={category} type="button" className={cn('flex h-11 w-full items-center gap-3 border-t border-border px-4 text-left text-xs', index === 0 && 'border-l-2 border-l-signal bg-signal/10 font-semibold text-signal-strong')}><BookText className="h-4 w-4" />{category}</button>)}</aside>
      </div>
    </>
  );
}

function NotificationsSettings() {
  const toggles = [false, false, false, false, false];
  const rules = [
    ['Критический дефект техники', 'Критический', 'Диспетчер, механик, мастер', 'Push · Telegram · SMS'],
    ['Наряд-допуск ожидает согласования', 'Высокий', 'Ответственный за наряды', 'Push · Telegram · Email'],
    ['ТО наступит через 50 м/ч', 'Средний', 'Механик', 'Push · Telegram · Email'],
    ['Смена не передана до 20:15', 'Высокий', 'Старший смены, диспетчер', 'Push · Telegram · SMS'],
    ['Потеря связи более 30 минут', 'Низкий', 'Диспетчер', 'Push · Email'],
  ] as const;
  return (
    <>
      <ScreenTitle heading="Уведомления" subtitle="Маршруты событий, приоритеты и контроль доставки" actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/telegram">Создать правило</Link></Button>} />
      <SettingsKpis items={[{ icon: 'settings', label: 'Правил', value: rules.length }, { icon: 'accepted', label: 'Активных', value: toggles.filter(Boolean).length }, { icon: 'notifications', label: 'Доставлено сегодня', value: '—' }, { icon: 'risk', label: 'Ошибок', value: 0 }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <section className={cn(card, 'overflow-x-auto p-4')}><div className="flex items-center justify-between"><div><h2 className="font-bold">Маршрутизация событий</h2><p className="mt-1 text-2xs text-muted-foreground">Правила активируются в подключённом канале уведомлений.</p></div><Button asChild variant="outline"><Link href="/admin/telegram">Журнал доставки</Link></Button></div><div className="mt-4 grid min-w-[720px] grid-cols-[1.2fr_120px_1fr_1fr_50px] border-b border-border pb-2 text-3xs uppercase text-muted-foreground"><span>Событие</span><span>Приоритет</span><span>Получатели</span><span>Каналы</span><span>Статус</span></div>{rules.map(([event, priority, recipients, channels], index) => <div key={event} className="grid min-w-[720px] grid-cols-[1.2fr_120px_1fr_1fr_50px] items-center border-b border-border py-3 text-xs"><span>{event}</span><span className={cn('mr-4 rounded border px-2 py-1 font-semibold', priority === 'Критический' ? 'border-destructive/25 bg-destructive/10 text-destructive-strong' : priority === 'Высокий' ? 'border-signal/25 bg-signal/10 text-signal-strong' : priority === 'Средний' ? 'border-info/25 bg-info/10 text-info-strong' : 'border-border bg-muted text-muted-foreground')}>{priority}</span><span>{recipients}</span><span>{channels}</span><Toggle checked={toggles[index]} /></div>)}</section>
          <section className={cn(card, 'p-4')}><h2 className="font-bold">Последние доставки</h2><div className="mt-4 grid grid-cols-5 border-b border-border pb-2 text-3xs uppercase text-muted-foreground"><span>Время</span><span>Канал</span><span>Событие</span><span>Получатель</span><span>Статус</span></div><div className="py-10 text-center text-xs text-muted-foreground">Доставок в текущем журнале нет. <Link href="/admin/telegram" className="font-semibold text-info-strong underline">Открыть Telegram</Link></div></section>
        </div>
        <aside className="space-y-3"><section className={cn(card, 'p-4')}><h2 className="font-bold">Каналы связи</h2><div className="mt-3 divide-y divide-border">{['Push PWA', 'Telegram', 'Email', 'SMS'].map((channel) => <div key={channel} className="flex items-center gap-3 py-3 text-xs"><Bell className="h-4 w-4 text-signal-strong" />{channel}</div>)}</div></section><section className={cn(card, 'p-4')}><h2 className="font-bold">Тихие часы</h2><div className="mt-3 flex items-center gap-2 text-sm font-bold text-foreground">☾ 22:00–06:00</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Уведомления низкого и среднего приоритета отправляются после окончания периода.</p></section><section className={cn(card, 'p-4')}><h2 className="font-bold">Эскалация</h2><p className="mt-2 text-xs text-muted-foreground">Повторная отправка при отсутствии подтверждения.</p></section></aside>
      </div>
    </>
  );
}

function IntegrationsSettings(props: ReferenceUiProps) {
  const devices = Object.values(props.details).flatMap((detail) => detail.telematicsDevices ?? []);
  const systems = [
    ['Телематика', devices.length ? `${devices.length} устройств` : 'Не подключена', devices.length > 0],
    ['Telegram Bot', 'Уведомления и команды', false],
    ['1С:ТОИР', 'Заявки и выполненные работы', false],
    ['REST API PilingTrack', 'Внешние клиенты', false],
    ['SMTP', 'Почтовые уведомления', false],
    ['Webhooks заказчика', 'Вебхуки и события', false],
  ] as const;
  return (
    <>
      <ScreenTitle heading="Интеграции" subtitle="Обмен с телематикой, Telegram и корпоративными системами" actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/settings">Подключить систему</Link></Button>} />
      <SettingsKpis items={[{ icon: 'settings', label: 'Подключено', value: systems.filter(([, , active]) => active).length }, { icon: 'reports', label: 'Передано сегодня', value: '—' }, { icon: 'history', label: 'В очереди', value: 0 }, { icon: 'risk', label: 'Ошибок', value: 0 }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3"><section className={cn(card, 'p-4')}><h2 className="font-bold">Подключённые системы</h2><div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{systems.map(([name, description, active], index) => <div key={name} className={cn('flex items-center gap-3 rounded-lg border p-3', index === 0 ? 'border-info/25 bg-info/10' : 'border-border')}><div className={cn('grid h-12 w-[72px] shrink-0 place-items-center rounded-lg px-1 text-center text-3xs font-extrabold leading-tight text-white', index % 3 === 0 ? 'bg-primary' : index % 3 === 1 ? 'bg-info-strong' : 'bg-warning-strong')}>{name.split(' ')[0]}</div><div className="min-w-0 flex-1"><div className="text-xs font-bold">{name}</div><div className="mt-1 text-2xs text-muted-foreground">{description}</div><div className={cn('mt-2 text-2xs font-semibold', active ? 'text-success-strong' : 'text-muted-foreground')}>● {active ? 'Работает' : 'Не настроено'}</div></div><span>⋮</span></div>)}</div></section><section className={cn(card, 'p-4')}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Очередь обмена</h2><span className="text-xs text-muted-foreground">Обработано сегодня: —</span></div><div className="mt-4 h-28 border-b border-l border-border"><div className="mt-12 h-px bg-border" /></div></section></div>
        <aside className="space-y-3"><section className={cn(card, 'p-4')}><h2 className="font-bold">{devices[0]?.label || 'Телематика'}</h2><div className="mt-4 space-y-3 text-xs"><InfoRow label="Статус" value={devices[0]?.status || 'Не подключена'} /><InfoRow label="Подключено устройств" value={String(devices.length)} /><InfoRow label="Интервал обмена" value="По настройке устройства" /></div><div className="mt-4 flex flex-wrap gap-2">{['Моточасы', 'Зажигание', 'GPS', 'CAN'].map((parameter) => <span key={parameter} className="rounded border border-border px-2 py-1 text-3xs">{parameter}</span>)}</div><Button variant="outline" className="mt-4 w-full">⚙ Настроить</Button></section><section className={cn(card, 'p-4')}><h2 className="font-bold">Ошибки обмена</h2><div className="mt-4 text-xs text-success-strong">Ошибок не обнаружено</div></section><section className={cn(card, 'p-4')}><h2 className="font-bold">API и безопасность</h2><p className="mt-2 text-xs text-muted-foreground">Ключи и доступ по IP управляются в системных настройках.</p><Button variant="outline" className="mt-3 w-full">Документация API</Button></section></aside>
      </div>
    </>
  );
}

function AuditSettings(props: ReferenceUiProps) {
  const events = useMemo(() => Object.values(props.journals).flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [props.journals]);
  return (
    <>
      <ScreenTitle heading="Аудит" subtitle="Неизменяемая история действий, решений и изменений данных" actions={<Button asChild variant="outline"><Link href="/admin/settings">Политика хранения</Link></Button>} />
      <SettingsKpis items={[{ icon: 'history', label: 'Событий за 24 ч', value: events.filter((event) => Date.now() - new Date(event.createdAt).getTime() < 86_400_000).length }, { icon: 'reports', label: 'Изменений данных', value: events.length }, { icon: 'risk', label: 'Критических действий', value: events.filter((event) => event.type === 'FAULT').length }, { icon: 'documents', label: 'Срок хранения', value: '—' }]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-x-auto')}>
          <div className="p-4"><div className="flex items-center gap-3"><h2 className="text-lg font-bold">Доказательный журнал</h2><span className="rounded border border-success/25 bg-success/10 px-2 py-1 text-xs text-success-strong">Целостность не настроена</span></div><div className="mt-4 flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Поиск по действию, объекту, пользователю…" className="h-10 pl-9 text-xs" /></div><button className="rounded-lg border border-border px-3 text-xs">Диапазон дат</button><button className="rounded-lg border border-border px-3 text-xs">Все типы действий</button><button className="rounded-lg border border-border px-3 text-xs">Все объекты</button><Button variant="outline">⚱ Фильтры</Button></div></div>
          <div className="grid min-w-[820px] grid-cols-[150px_150px_1fr_160px_110px_20px] border-y border-border px-4 py-2 text-3xs uppercase text-muted-foreground"><span>Время</span><span>Пользователь</span><span>Действие</span><span>Объект</span><span>Результат</span><span /></div>
          <div className="max-h-[500px] min-w-[820px] divide-y divide-border overflow-y-auto">{events.slice(0, 12).map((event) => <div key={event.id} className="grid grid-cols-[150px_150px_1fr_160px_110px_20px] items-center px-4 py-2 text-xs hover:bg-signal/5"><span>{new Date(event.createdAt).toLocaleString('ru-RU')}</span><span><b>Система</b><br /><small className="text-muted-foreground">PilingTrack</small></span><span>{event.title}</span><span>{event.type}</span><span className={cn('font-semibold', event.type === 'FAULT' ? 'text-destructive-strong' : 'text-success-strong')}>{event.type === 'FAULT' ? 'Критично' : 'Успешно'}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>)}</div>
          {events.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">События аудита недоступны в текущем источнике.</div>}
          <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground"><span>Показано 1–{Math.min(12, events.length)} из {events.length} событий</span><span>20 на странице · 1 2 3</span></div>
        </section>
        <aside className="space-y-3"><section className={cn(card, 'p-4')}><h2 className="font-bold">Событие {events[0] ? `#${events[0].id.slice(0, 6)}` : '—'}</h2><div className="mt-4 space-y-3 text-xs"><InfoRow label="Автор" value="Система" /><InfoRow label="Дата и время" value={events[0] ? new Date(events[0].createdAt).toLocaleString('ru-RU') : '—'} /><InfoRow label="Действие" value={events[0]?.title || '—'} /></div><div className="mt-4 overflow-x-auto rounded-lg bg-primary p-3 font-mono text-3xs leading-relaxed text-border"><div className="text-muted-foreground">файл: readiness-state.json</div><div className="mt-2 text-success-foreground">+ &quot;status&quot;: &quot;{events[0]?.status || 'none'}&quot;</div><div className="text-border">  &quot;type&quot;: &quot;{events[0]?.type || 'none'}&quot;</div></div></section><section className={cn(card, 'p-4')}><h2 className="font-bold">Целостность журнала</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">SHA-256 цепочка пока отсутствует в модели AuditLog, поэтому статус «Цепочка цела» не заявляется.</p></section><Button className="w-full bg-signal-strong hover:bg-signal-strong" onClick={() => downloadCsv('readiness-audit.csv', [['Дата', 'Действие', 'Тип', 'Статус'], ...events.map((event) => [event.createdAt, event.title, event.type, event.status])])}>Экспорт журнала</Button></aside>
      </div>
    </>
  );
}
