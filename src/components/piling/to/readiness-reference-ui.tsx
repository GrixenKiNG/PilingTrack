'use client';

import { cn } from '@/lib/utils';
import {
  BarChart3,
  CalendarClock,
  FileText,
  HardHat,
  Settings2,
  ShieldCheck,
  Wrench,
  WifiOff,
} from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { ReadinessFiltersBar } from './readiness/screens/shared';
import { ReadinessCentre } from './readiness/screens/readiness-centre';
import { FleetScreen } from './readiness/screens/fleet-screen';
import { ShiftsScreen } from './readiness/screens/shifts-screen';
import { PermitsScreen } from './readiness/screens/permits-screen';
import { MaintenanceScreen } from './readiness/screens/maintenance-screen';
import { DocumentsScreen } from './readiness/screens/documents-screen';
import { ReportsScreen } from './readiness/screens/reports-screen';
import { SettingsWorkspace } from './readiness/screens/settings-workspace';
import type { ReferenceUiProps, ReferenceView } from './readiness/screens/types';

/**
 * Оболочка модуля «Техготовность»: шапка, состояния загрузки и выбор экрана.
 *
 * Сами экраны живут в `readiness/screens/*`. Файл разросся до 3736 строк —
 * семь экранов, их помощники и общие компоненты в одном месте, — и правка
 * одного экрана заставляла листать все остальные.
 */

// Публичный контракт модуля сохранён: внешние потребители (to-module,
// module-tab-list) продолжают импортировать эти имена отсюда.
export type {
  EquipmentDetailSnapshot,
  ReferenceUiProps,
  ReferenceView,
  SettingsSection,
} from './readiness/screens/types';

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

export function ReadinessReferenceUi(props: ReferenceUiProps) {
  const initialLoading = props.loading && props.equipment.length === 0;
  const fatalError = Boolean(props.workspaceError && props.equipment.length === 0);

  return (
    <div
      aria-busy={props.loading}
      className="tech-readiness-module min-h-screen w-full min-w-0 overflow-x-hidden overflow-y-auto bg-background font-sans text-foreground"
    >
      <div className="min-h-screen w-full min-w-0">
        {/* У модуля не было заголовка первого уровня: разметка начиналась с h2
            «Banut 655», и для скринридера страница оставалась без названия.
            Скрыт визуально — на экране роль заголовка играет полоса вкладок,
            дублировать её текстом незачем. */}
        <h1 className="sr-only">
          Техническая готовность — {VIEW_ITEMS.find((item) => item.id === props.view)?.label ?? 'Центр готовности'}
        </h1>
        {props.showInternalNavigation && <header
          aria-label="Разделы модуля технической готовности"
          className="sticky top-0 z-20 flex h-12 w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-card px-2 sm:px-4"
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
                  'relative inline-flex h-full shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground',
                  props.view === item.id && 'font-semibold text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-signal',
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
              className="w-full max-w-lg rounded-[14px] border border-destructive/30 bg-card p-6 text-center shadow-sm"
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
          <div className="min-w-0 px-2 sm:px-4">
            {(props.view === 'shifts' || props.view === 'permits' || props.view === 'reports') && (
              <ReadinessFiltersBar filters={props.filters} onChange={props.onFiltersChange} mode={props.view} />
            )}
            {props.view === 'readiness' && <ReadinessCentre {...props} />}
            {props.view === 'fleet' && <FleetScreen {...props} />}
            {props.view === 'shifts' && <ShiftsScreen {...props} />}
            {props.view === 'permits' && <PermitsScreen {...props} />}
            {props.view === 'maintenance' && <MaintenanceScreen {...props} />}
            {props.view === 'documents' && <DocumentsScreen {...props} />}
            {props.view === 'reports' && <ReportsScreen {...props} />}
          </div>
        )}
      </div>
    </div>
  );
}