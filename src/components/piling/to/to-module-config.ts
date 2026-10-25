import { MODULE_TABS, SAFETY_TABS, type ModuleTab } from './readiness/module-tab-list';
import { type ReferenceView, type SettingsSection } from './readiness-reference-ui';
import { type ReadinessEvidence, type ReadinessStatus } from './readiness-model';

// Список обязан покрывать ОБА набора вкладок — MODULE_TABS и SAFETY_TABS: он
// сторожит ?view= в адресе, и пропущенное здесь значение выглядит как «такой
// вкладки нет» — переход по закладке молча возвращает на домашний раздел.
const VIEW_IDS = new Set<ReferenceView>([
  'my-clearance',
  'readiness',
  'fleet',
  'shifts',
  'permits',
  'maintenance',
  'safety',
  'employees',
  'instructions',
  'knowledge',
  'documents',
  'briefings',
  'incidents',
  'reports',
  'settings',
]);

/**
 * Исход авторитетного расчёта — в статус карточки парка.
 *
 * «Готова с замечанием» и «требует решения» сводятся к одному «внимание»:
 * у карточки парка нет отдельного цвета под каждое, а зелёным их красить
 * нельзя — замечание тогда некому заметить.
 */
export const OUTCOME_STATUS: Record<string, ReadinessStatus> = {
  READY: 'READY',
  READY_WITH_WARNING: 'ATTENTION',
  ATTENTION: 'ATTENTION',
  BLOCKED: 'BLOCKED',
};

export const STAGE_EVIDENCE_KEY: Record<string, ReadinessEvidence['key']> = {
  INSPECTION: 'inspection',
  ENGINE_HOURS: 'meter',
  PERMIT: 'permit',
  MAINTENANCE: 'maintenance',
  ACCEPTANCE: 'acceptance',
};

export const STAGE_EVIDENCE_STATE: Record<string, ReadinessEvidence['state']> = {
  pass: 'pass',
  warning: 'warning',
  fail: 'block',
  unknown: 'missing',
};

const SETTINGS_IDS = new Set<SettingsSection>([
  'rules',
  'checklists',
  'roles',
  'dictionaries',
  'notifications',
  'integrations',
  'audit',
]);

export const TECH_READINESS_PRODUCTION_SHELL_ENABLED =
  process.env.NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL !== 'false';

/**
 * Отказ чтения журнала дефектов. Отдельное состояние, а не только строка в
 * общем баннере: счётчик критических дефектов решает допуск установки, и ноль в
 * нём при отказе читался бы как «замечаний нет» (F-N1005-DEFECTS-UNKNOWN).
 */
export const DEFECTS_UNAVAILABLE_MESSAGE = 'Не удалось загрузить журнал дефектов.';
export const PERMITS_UNAVAILABLE_MESSAGE = 'Сервер не отдал список нарядов. Повторите загрузку.';

/**
 * Какой модуль показывает оболочка. Данные и экраны у них общие, разные —
 * набор вкладок, адрес и то, куда попадаешь без `?view=`.
 */
export type ModuleSurface = 'readiness' | 'safety';

export const SURFACE_TABS: Record<ModuleSurface, ReadonlyArray<ModuleTab>> = {
  readiness: MODULE_TABS,
  safety: SAFETY_TABS,
};

export const SURFACE_ROUTE: Record<ModuleSurface, string> = {
  readiness: '/admin/to',
  safety: '/admin/safety',
};

export const SURFACE_LABEL: Record<ModuleSurface, string> = {
  readiness: 'Техническая готовность',
  safety: 'ТБ и допуски',
};

/** Раздел, который открывается без `?view=` в адресе. */
export const SURFACE_HOME: Record<ModuleSurface, ReferenceView> = {
  readiness: 'readiness',
  // Домашний раздел «ТБ и допусков» — сводка инженера ОТ. Роли без его прав
  // туда не попадут: подстановка первой разрешённой вкладки уведёт их на
  // «Мой допуск», открытый каждому.
  safety: 'safety',
};

/** Какому модулю принадлежит раздел. Раздел живёт ровно в одном. */
export function surfaceOfView(view: ReferenceView): ModuleSurface {
  return SAFETY_TABS.some((tab) => tab.id === view) ? 'safety' : 'readiness';
}

export const parseView = (value: string | null, surface: ModuleSurface): ReferenceView => {
  if (value === 'journal' || value === 'meters' || value === 'plans') return 'maintenance';
  return value && VIEW_IDS.has(value as ReferenceView)
    ? value as ReferenceView
    : SURFACE_HOME[surface];
};

export const parseSettingsSection = (value: string | null): SettingsSection =>
  value && SETTINGS_IDS.has(value as SettingsSection) ? value as SettingsSection : 'rules';
