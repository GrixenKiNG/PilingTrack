import { PermittedEntityHistory } from '@/components/piling/ops-shell/permitted-entity-history';
import { HardHat, Pencil, Trash2, UserPlus, CheckCircle2, TrendingUp, Network, Power, PowerOff } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { formatNumber, pluralizeRu } from '@/lib/format';
import { OpsDetailPanel, OpsFact, OpsRiskBadge, resolveRisk } from '@/components/piling/ops-shell';
import { HierarchyTree } from './hierarchy-tree';
import { type SiteOverviewRow } from './use-sites-overview';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import type { SiteCrew, SiteFullData } from './types';
import { formatDowntimeHours } from '@/lib/downtime-hours';

export function siteRisk(row: SiteOverviewRow) {
  return resolveRisk(
    [
      [!row.isActive, 'critical', 'Неактивен'],
      [row.totalReports === 0, 'critical', 'Нет отчётов'],
      [row.plannedPiles > 0 && row.pileProgress < 60, 'warn', 'Отставание'],
      [row.crewCount === 0, 'warn', 'Без бригад'],
    ],
    'В графике',
  );
}

export function pct(value: number): string {
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

export function SiteDetail({
  row, canManage, togglingId, completingId, tree, treeError, onRetryTree, onEdit, onDelete, onAssign, onToggleCompleted, onToggleActive, onAddHierarchy, onDeleteHierarchy,
}: {
  row: SiteOverviewRow;
  canManage: boolean;
  togglingId: string | null;
  completingId: string | null;
  tree?: SiteFullData;
  treeError: boolean;
  onRetryTree: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onToggleCompleted: () => void;
  onToggleActive: () => void;
  onAddHierarchy: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDeleteHierarchy: (siteId: string, type: string, itemId: string) => void;
}) {
  const risk = siteRisk(row);
  const completed = Boolean(row.completionDate);
  return (
    <OpsDetailPanel title={row.siteName} subtitle={`Объект · ${row.totalReports} ${pluralizeRu(row.totalReports, ['отчёт', 'отчёта', 'отчётов'])}`} status={<OpsRiskBadge level={risk.level} label={risk.label} />}>
      {canManage && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} className="h-11 text-xs sm:h-8"><Pencil className="mr-1 h-3.5 w-3.5" />Редактировать</Button>
        <Button size="sm" variant="outline" onClick={onAssign} className="h-11 text-xs sm:h-8"><UserPlus className="mr-1 h-3.5 w-3.5" />Назначить пользователей</Button>
        <Button size="sm" variant="outline" onClick={onToggleCompleted} disabled={completingId === row.siteId} className="h-11 text-xs sm:h-8"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{completed ? 'Снять «Выполнен»' : 'Выполнен'}</Button>
        <Button size="sm" variant="outline" onClick={onToggleActive} disabled={togglingId === row.siteId} className="h-11 text-xs sm:h-8">{row.isActive ? <PowerOff className="mr-1 h-3.5 w-3.5" /> : <Power className="mr-1 h-3.5 w-3.5" />}{row.isActive ? 'Деактивировать' : 'Активировать'}</Button>
        <Button size="sm" variant="outline" onClick={onDelete} className="h-11 text-xs text-destructive-strong hover:bg-destructive/10 sm:h-8"><Trash2 className="mr-1 h-3.5 w-3.5" />Удалить навсегда</Button>
      </div>}

      <div className="grid grid-cols-2 divide-x rounded-md border border-border bg-muted">
        <OpsFact label="Сваи план" value={`${formatNumber(row.plannedPiles)} шт.`} sub={`${formatNumber(row.plannedPileMeters)} м.п.`} />
        <OpsFact label="Сваи факт" value={`${formatNumber(row.actualPiles)} шт.`} sub={`${formatNumber(row.actualPileMeters)} м.п.`} />
      </div>
      <div className="grid grid-cols-2 divide-x rounded-md border border-border">
        <OpsFact label="Бурение план" value={`${formatNumber(row.plannedDrillingCount)} шт.`} sub={`${formatNumber(row.plannedDrilling)} м.п.`} />
        <OpsFact label="Бурение факт" value={`${formatNumber(row.actualDrillingCount)} шт.`} sub={`${formatNumber(row.actualDrilling)} м.п.`} />
      </div>
      <div className="grid grid-cols-1 rounded-md border border-border">
        <OpsFact label="Простой" value={row.totalDowntime > 0 ? formatDowntimeHours(row.totalDowntime) : '—'} />
      </div>

      <div className="rounded-md border border-border p-2.5">
        <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground"><TrendingUp className="h-4 w-4 text-muted-foreground" />Прогресс</h3>
        <LabeledProgress label="Сваи" pct={row.pileProgress} planned={row.plannedPiles} tone="orange" />
        <LabeledProgress label="Бурение" pct={row.drillingProgress} planned={row.plannedDrilling} tone="blue" />
      </div>

      <SiteCrewBoard crews={tree?.crews} error={treeError} />

      <div className="rounded-md border border-border p-2.5">
        <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground"><Network className="h-4 w-4 text-muted-foreground" />Иерархия</h3>
        {tree
          ? <HierarchyTree readOnly={!canManage} siteId={row.siteId} tree={tree} onAdd={onAddHierarchy} onDelete={onDeleteHierarchy} />
          : treeError
            ? (
              <div className="space-y-2">
                <p className="text-2xs text-destructive-strong">Не удалось загрузить структуру</p>
                <Button size="sm" variant="outline" onClick={onRetryTree} className="h-11 text-xs sm:h-8">Повторить</Button>
              </div>
            )
            : <p className="text-2xs text-muted-foreground">Загрузка структуры…</p>}
      </div>

      <PermittedEntityHistory scope="sites" targetId={row.siteId} title="История изменений" />
    </OpsDetailPanel>
  );
}

// Подписи к общему состоянию установки (@/modules/equipment).
const EQUIPMENT_STATE: Record<string, { label: string; className: string }> = {
  working: { label: 'В работе', className: 'bg-success/15 text-success-strong' },
  repair: { label: 'В ремонте', className: 'bg-destructive/15 text-destructive-strong' },
  idle: { label: 'Простой', className: 'bg-warning/15 text-warning-strong' },
};

/**
 * Кто и на чём работает на объекте.
 *
 * ЗАЧЕМ В КАРТОЧКЕ ОБЪЕКТА. План и факт отвечают «сколько сделано», но не
 * «чем и кем». Закрепление жило в модуле бригад, и чтобы узнать, какие машины
 * стоят на объекте, приходилось уходить с экрана и искать по обратной связи.
 *
 * ПОЧЕМУ ФОТО. Установки различают глазами, а не по строке «КБУРГ-16.02 №1»:
 * снимок модели узнаётся быстрее названия. Снимка на модель нет — показываем
 * название, а не пустую рамку.
 */
function SiteCrewBoard({ crews, error }: { crews?: SiteCrew[]; error?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
        <HardHat className="h-4 w-4 text-muted-foreground" />
        Установки и бригады
        {crews?.length ? <span className="font-mono text-2xs text-muted-foreground">{crews.length}</span> : null}
      </h3>

      {crews === undefined && error ? (
        <p className="text-2xs max-sm:text-sm! text-destructive-strong">Состав бригад не загрузился — обновите страницу.</p>
      ) : null}
      {crews === undefined && !error ? <p className="text-2xs max-sm:text-sm! text-muted-foreground">Загрузка…</p> : null}
      {crews?.length === 0 ? (
        <p className="text-2xs max-sm:text-sm! text-muted-foreground">
          За объектом не закреплено ни одной бригады. Закрепление — в модуле «Бригады».
        </p>
      ) : null}

      <ul className="space-y-2">
        {(crews ?? []).map((crew) => {
          const photo = getEquipmentPhoto(crew.equipment?.model);
          const state = crew.equipmentState ? EQUIPMENT_STATE[crew.equipmentState] : null;
          return (
            <li key={crew.id} className="flex gap-2.5 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded border border-border bg-muted">
                {photo ? (

                  <img src={photo} alt={crew.equipment?.name ?? 'Установка'} className="h-full w-full object-cover" />
                ) : (
                  // Снимка на эту модель нет. Название не повторяем — оно уже
                  // стоит заголовком справа, и дубль читается как ошибка.
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <HardHat className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-semibold text-foreground max-sm:text-sm">
                    {crew.equipment?.name ?? 'Установка не закреплена'}
                  </p>
                  {state ? (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-3xs font-semibold ${state.className}`}>
                      {state.label}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-2xs max-sm:text-sm! text-muted-foreground">
                  {crew.name || 'Бригада без названия'}
                  {crew.operator ? ` · ${crew.operator.name}` : ''}
                </p>
                {crew.assistants.length > 0 ? (
                  <p className="truncate text-2xs max-sm:text-sm! text-muted-foreground">
                    Помощники: {crew.assistants.map((assistant) => assistant.name).join(', ')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProgressBar({ pct: value, tone }: { pct: number; tone: 'orange' | 'blue' }) {
  return (
    <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
      <div className={tone === 'orange' ? 'h-full rounded-full bg-signal' : 'h-full rounded-full bg-info-strong'} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

function LabeledProgress({ label, pct: value, planned, tone }: { label: string; pct: number; planned?: number; tone: 'orange' | 'blue' }) {
  // No plan set → percent is meaningless; show "—" instead of a misleading 0%.
  const noPlan = planned !== undefined && planned <= 0;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 flex items-center justify-between text-2xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{noPlan ? 'план не задан' : pct(value)}</span>
      </div>
      <ProgressBar pct={noPlan ? 0 : value} tone={tone} />
    </div>
  );
}
