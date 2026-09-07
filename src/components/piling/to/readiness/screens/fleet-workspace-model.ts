import type { ReferenceUiProps } from './types';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation } from '../authoritative-presentation';

export type FleetGroup = 'ready' | 'attention' | 'blocked' | 'unknown';
/**
 * Вид один — таблица.
 *
 * Карточный вариант жил здесь как второй режим, но переключателя в интерфейсе
 * не осталось: включить его можно было только руками через `fleetLayout=cards`
 * в адресе. Экран сравнивает установки по статусу и причине — это работа
 * таблицы; карточки повторяли раздел «Установки», где парк и показывают
 * плитками.
 */
export type FleetViewState = {
  query: string;
  site: string;
  status: 'all' | FleetGroup;
  sort: 'priority' | 'name' | 'hours';
};

export const DEFAULT_FLEET_VIEW: FleetViewState = {
  query: '', site: '', status: 'all', sort: 'priority',
};

export const FLEET_GROUP_LABELS: Record<FleetGroup, string> = {
  ready: 'Готово', attention: 'Требует внимания', blocked: 'Заблокировано', unknown: 'Не подтверждено',
};

export function readFleetViewState(search: string): FleetViewState {
  const params = new URLSearchParams(search);
  const status = params.get('fleetStatus');
  const sort = params.get('fleetSort');
  return {
    query: params.get('fleetQuery') ?? '',
    site: params.get('fleetSite') ?? '',
    status: status === 'ready' || status === 'attention' || status === 'blocked' || status === 'unknown' ? status : 'all',
    sort: sort === 'name' || sort === 'hours' ? sort : 'priority',
  };
}

/** Namespace local filters so they never narrow the readiness API of another tab. */
export function writeFleetViewState(search: string, state: FleetViewState): string {
  const params = new URLSearchParams(search);
  const pairs = {
    fleetQuery: state.query, fleetSite: state.site,
    fleetStatus: state.status === 'all' ? '' : state.status,
    fleetSort: state.sort === 'priority' ? '' : state.sort,
    // Прежний ключ вида списка стираем: адрес со старой ссылки не должен
    // тащить за собой параметр, которого экран больше не понимает.
    fleetLayout: '',
  };
  Object.entries(pairs).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
  return params.toString();
}

export function buildFleetItems(props: Pick<ReferenceUiProps, 'equipment' | 'fleetCards' | 'currentReadiness' | 'authoritativeReadinessError'>) {
  const snapshots = new Map(props.currentReadiness.map((item) => [item.equipmentId, item]));
  const cards = new Map(props.fleetCards.map((item) => [item.id, item]));
  return props.equipment.map((equipment) => {
    const snapshot = snapshots.get(equipment.id) ?? null;
    // A missing or failed authoritative response must never fall back to a green legacy score.
    const presentation = props.authoritativeReadinessError
      ? buildUnavailableReadinessPresentation(snapshot)
      : buildAuthoritativeReadinessPresentation(snapshot);
    const group: FleetGroup = presentation.outcome === 'UNCONFIRMED' ? 'unknown'
      : presentation.outcome === 'BLOCKED' ? 'blocked'
        : presentation.outcome === 'READY' ? 'ready' : 'attention';
    const fleet = cards.get(equipment.id);
    const reason = presentation.blockers[0]?.label ?? presentation.warnings[0]?.label
      ?? (group === 'unknown' ? 'Нет подтверждённой оценки'
        : group === 'ready' ? 'Блокирующих условий в оценке нет' : presentation.description);
    return { equipment, fleet, snapshot, presentation, group, reason,
      site: fleet?.assignedSiteName || 'Без объекта' };
  });
}

export type FleetItem = ReturnType<typeof buildFleetItems>[number];

export function filterFleetItems(items: FleetItem[], view: FleetViewState): FleetItem[] {
  const query = view.query.trim().toLocaleLowerCase('ru-RU');
  const priorities: Record<FleetGroup, number> = { blocked: 0, unknown: 1, attention: 2, ready: 3 };
  return items.filter((item) =>
    (view.status === 'all' || item.group === view.status)
    && (!view.site || item.site === view.site)
    && [item.equipment.name, item.equipment.model, item.site, item.fleet?.assignedCrewName]
      .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(query),
  ).sort((a, b) => {
    const order = view.sort === 'priority' ? priorities[a.group] - priorities[b.group]
      : view.sort === 'hours' ? (b.equipment.engineHoursTotal ?? -1) - (a.equipment.engineHoursTotal ?? -1) : 0;
    return order || a.equipment.name.localeCompare(b.equipment.name, 'ru-RU', { numeric: true });
  });
}

export function countFleetGroups(items: FleetItem[]): Record<FleetGroup, number> {
  return items.reduce((counts, item) => {
    counts[item.group] += 1;
    return counts;
  }, { ready: 0, attention: 0, blocked: 0, unknown: 0 });
}
