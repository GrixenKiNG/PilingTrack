import type { Dispatch, SetStateAction } from 'react';
import { type ModuleSurface, SURFACE_ROUTE, SURFACE_HOME, surfaceOfView } from './to-module-config';
import { type ReadinessUrlFilters } from './readiness/api/client';
import { type ReferenceView, type SettingsSection } from './readiness-reference-ui';

interface ToNavigationBindings {
  equipmentId: string;
  surface: ModuleSurface;
  setView: Dispatch<SetStateAction<ReferenceView>>;
  settingsSection: SettingsSection;
  setSettingsSection: Dispatch<SetStateAction<SettingsSection>>;
  setEquipmentId: Dispatch<SetStateAction<string>>;
  view: ReferenceView;
  setReadinessFilters: Dispatch<SetStateAction<ReadinessUrlFilters>>;
}

export function createToNavigation({ equipmentId, surface, setView, settingsSection, setSettingsSection, setEquipmentId, view, setReadinessFilters }: ToNavigationBindings) {


  const replaceUrlState = (
    nextView: ReferenceView,
    nextSection: SettingsSection,
    nextEquipmentId = equipmentId,
  ) => {
    const url = new URL(window.location.href);
    if (nextView === SURFACE_HOME[surface]) url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    if (nextView === 'settings') url.searchParams.set('section', nextSection);
    else url.searchParams.delete('section');
    if (nextEquipmentId) url.searchParams.set('equipmentId', nextEquipmentId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const changeView = (next: ReferenceView) => {
    // Раздел чужого модуля (например, «Происшествия» из обзора «ТБ и допусков»,
    // переехавшие в «Техготовность») открывается его адресом: в чужой оболочке
    // не подсветилась бы ни одна вкладка.
    if (surfaceOfView(next) !== surface) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- полная загрузка нужна: оболочка другого модуля монтируется заново (как у старых ссылок выше)
      window.location.assign(`${SURFACE_ROUTE[surfaceOfView(next)]}?view=${next}`);
      return;
    }
    setView(next);
    replaceUrlState(next, settingsSection);
  };

  const changeSettingsSection = (next: SettingsSection) => {
    setSettingsSection(next);
    replaceUrlState('settings', next);
  };

  const changeEquipment = (next: string) => {
    setEquipmentId(next);
    replaceUrlState(view, settingsSection, next);
  };

  const changeReadinessFilters = (next: ReadinessUrlFilters) => {
    setReadinessFilters(next);
    const url = new URL(window.location.href);
    for (const key of ['status', 'from', 'to', 'shiftType', 'risk', 'eventType', 'actor'] as const) {
      const value = next[key];
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };
  return { changeView, changeSettingsSection, changeEquipment, changeReadinessFilters };
}
