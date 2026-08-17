'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Bell, BookText, Building2, CheckCircle2, ClipboardCheck, FileBarChart, FileText, Gauge, History, Link2, Lock, ShieldCheck, Users, Wrench } from '@/components/piling/icons/unified-icons';
import { ScreenTitle, Toggle, card } from '../settings/shared-ui';
import { ChecklistsSettings } from '../settings/checklists-section';
import { RolesSettings } from '../settings/roles-section';
import { DictionariesSettings } from '../settings/dictionaries-section';
import { NotificationsSettings } from '../settings/notifications-section';
import { IntegrationsSettings } from '../settings/integrations-section';
import { AuditSettings } from '../settings/audit-section';
import { auditActionLabel, auditEntityLabel } from '../settings/audit-labels';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { BLOCKER_ACTIONS, BLOCKER_ACTION_LABELS, BLOCKER_LABELS, CRITERION_LABELS, SYSTEM_SAFETY_BLOCKERS, computeReadinessScore, describeRuleSetChanges, normalizeWeights, type BlockerAction, type ReadinessCriterionKey, type ReadinessRuleSet, type ReadinessRulesState } from '@/modules/readiness';
import { resolveReadinessCapabilities, type ReadinessAbility, type ReadinessRole } from '@/modules/readiness/application/capabilities';
import { type ReadinessUrlFilters } from '../api/client';
import { EquipmentPhoto, ReadinessFiltersBar, ReadinessRing, downloadReadinessExport } from './shared';
import type { ReferenceUiProps, SettingsSection } from './types';

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


export function SettingsWorkspace(props: ReferenceUiProps) {
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
      <div className="min-w-0 px-2 sm:px-4">
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
      </div>
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

const ROLE_COLUMNS: ReadonlyArray<{ role: ReadinessRole; label: string }> = [
  { role: 'OPERATOR', label: 'Оператор' },
  { role: 'DISPATCHER', label: 'Диспетчер' },
  { role: 'MECHANIC', label: 'Механик' },
  { role: 'ADMIN', label: 'Админ' },
];

/**
 * Сводка матрицы доступов: четыре строки, как в макете. Полная живёт в разделе
 * «Роли и доступы».
 *
 * Значения считаются из `resolveReadinessCapabilities` — того же источника, по которому
 * сервер пропускает команду. Раньше здесь стояли зашитые галочки, и три строки
 * из четырёх врали: администратору приписывались «открывать смену» и
 * «принимать технику», которых у него нет, а у диспетчера отнималось
 * «закрывать дефекты», которое есть. Две вкладки одного раздела показывали
 * разные права на одни и те же роли.
 */
const ROLE_MATRIX: ReadonlyArray<{ permission: string; ability: ReadinessAbility }> = [
  { permission: 'Открывать смену', ability: 'readiness.shift.manage' },
  { permission: 'Принимать технику', ability: 'readiness.handover.decide' },
  { permission: 'Закрывать дефекты', ability: 'readiness.defect.manage' },
  { permission: 'Изменять правила', ability: 'readiness.rules.manage' },
];

const ROLE_MATRIX_ABILITIES = new Map(
  ROLE_COLUMNS.map(({ role }) => [role, resolveReadinessCapabilities(role)]),
);

/** Ползунок веса: 60% — практический потолок одного критерия. */
const WEIGHT_SLIDER_MAX = 60;

// Высота элемента 24px (44px на сенсоре), а трек рисуется полосой 6px по
// центру через background-size — вид прежний, но цель нажатия перестала быть
// шестипиксельной ниткой. Растягивать сам трек нельзя: градиент заливки
// задан inline на элементе, до ::-webkit-slider-runnable-track он не достаёт.
const WEIGHT_SLIDER_CLASS = 'h-6 [@media(pointer:coarse)]:h-11 bg-no-repeat bg-center [background-size:100%_6px] min-w-0 cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
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
                          // h-full: поле тянется на всю высоту рамки (32px).
                          // Само по себе оно было 16px — ниже минимальной цели.
                          className="h-full w-full min-w-0 border-none bg-transparent text-right font-mono text-xs font-bold outline-none disabled:text-muted-foreground"
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
                  // Системное правило безопасности показываем замком, а не
                  // переключателем: сервер всё равно вернёт его включённым, и
                  // выключатель, который ничего не выключает, — обман.
                  const system = SYSTEM_SAFETY_BLOCKERS[blocker.condition];
                  return (
                    <div key={blocker.condition} className="grid grid-cols-[minmax(0,1fr)_128px_44px] items-center gap-2 border-b border-border py-2 text-2xs last:border-b-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', blocker.isActive ? (advisory ? 'text-warning-strong' : 'text-destructive-strong') : 'text-muted-foreground')} />
                        <span className="min-w-0 leading-tight">
                          {BLOCKER_LABELS[blocker.condition]}
                          {system ? <span className="mt-0.5 block text-3xs font-normal text-muted-foreground">{system.reason}</span> : null}
                        </span>
                      </span>
                      {system ? (
                        <span className="rounded border border-destructive/25 bg-destructive/10 px-1 py-1 text-3xs font-semibold text-destructive-strong">
                          {BLOCKER_ACTION_LABELS[blocker.action]}
                        </span>
                      ) : (
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
                      )}
                      <span className="flex justify-end">
                        {system ? (
                          <Lock className="h-4 w-4 text-muted-foreground" aria-label="Системное правило, отключить нельзя" />
                        ) : (
                          <Toggle checked={blocker.isActive} onChange={saving || rulesUnavailable ? undefined : (isActive) => patchBlocker(blocker.condition, { isActive })} label={`Включить правило ${BLOCKER_LABELS[blocker.condition]}`} />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border p-3">
                <h3 className="font-bold">Роли и доступы</h3>
                <div className="mt-2 grid min-w-[286px] grid-cols-[104px_repeat(4,minmax(0,1fr))] text-3xs font-semibold text-muted-foreground">
                  <span />{ROLE_COLUMNS.map(({ role, label }) => <span key={role} className="truncate text-center">{label}</span>)}
                </div>
                {ROLE_MATRIX.map((row) => (
                  <div key={row.ability} className="grid min-w-[286px] grid-cols-[104px_repeat(4,minmax(0,1fr))] items-center border-t border-border py-1.5 text-2xs">
                    <span>{row.permission}</span>
                    {ROLE_COLUMNS.map(({ role, label }) => (
                      <span key={role} className="flex justify-center">
                        {ROLE_MATRIX_ABILITIES.get(role)?.has(row.ability)
                          ? <CheckCircle2 className="h-4 w-4 text-success-strong" aria-label={`${label}: разрешено`} />
                          : <span className="text-muted-foreground" aria-label={`${label}: недоступно`}>—</span>}
                      </span>
                    ))}
                  </div>
                ))}
                <p className="mt-2 text-3xs leading-relaxed text-muted-foreground">
                  Администратор ведёт смену и принимает технику через режим «Действую как» —
                  собственных прав на эти действия у него нет.
                </p>
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
