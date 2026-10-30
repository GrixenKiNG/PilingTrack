import { toast } from 'sonner';
import { Bell, BookText, CheckCircle2, ClipboardCheck, FileBarChart, FileText, Gauge, Link2, ShieldCheck, Users, Wrench } from '@/components/piling/icons/unified-icons';
import { type ReadinessCriterionKey } from '@/modules/readiness';
import { resolveReadinessCapabilities, type ReadinessAbility, type ReadinessRole } from '@/modules/readiness';
import { type ReadinessUrlFilters } from '../api/client';
import { downloadReadinessExport } from './shared';
import type { SettingsSection } from './types';

export const SETTINGS_ITEMS: Array<{
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

/** Ключи фильтров ленты аудита — те же, что активны в режиме 'audit' панели фильтров. */
export const AUDIT_FILTER_KEYS = ['from', 'to', 'eventType', 'actor'] as const;

export async function downloadCsv(filename: string, _rows: Array<Array<string | number | null | undefined>>) {
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
  try {
    await downloadReadinessExport(dataset, filters);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Не удалось сформировать экспорт');
  }
}

/** Своя иконка на критерий — по макету, но из общего набора модуля. */
export const CRITERION_ICONS: Record<ReadinessCriterionKey, typeof ClipboardCheck> = {
  INSPECTION: ClipboardCheck,
  ENGINE_HOURS: Gauge,
  PERMIT: FileText,
  MAINTENANCE: Wrench,
  ACCEPTANCE: CheckCircle2,
};

export const ROLE_COLUMNS: ReadonlyArray<{ role: ReadinessRole; label: string }> = [
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
export const ROLE_MATRIX: ReadonlyArray<{ permission: string; ability: ReadinessAbility }> = [
  { permission: 'Открывать смену', ability: 'readiness.shift.manage' },
  { permission: 'Принимать технику', ability: 'readiness.handover.decide' },
  { permission: 'Допускать смену к пуску', ability: 'readiness.shift.authorize' },
  { permission: 'Разрешать пуск при блокировке', ability: 'readiness.shift.waive' },
  { permission: 'Закрывать дефекты', ability: 'readiness.defect.manage' },
  { permission: 'Изменять правила', ability: 'readiness.rules.manage' },
];

export const ROLE_MATRIX_ABILITIES = new Map(
  ROLE_COLUMNS.map(({ role }) => [role, resolveReadinessCapabilities(role)]),
);

/** Ползунок веса: 60% — практический потолок одного критерия. */
export const WEIGHT_SLIDER_MAX = 60;

// Высота элемента 24px (44px на сенсоре), а трек рисуется полосой 6px по
// центру через background-size — вид прежний, но цель нажатия перестала быть
// шестипиксельной ниткой. Растягивать сам трек нельзя: градиент заливки
// задан inline на элементе, до ::-webkit-slider-runnable-track он не достаёт.
export const WEIGHT_SLIDER_CLASS = 'h-6 [@media(pointer:coarse)]:h-11 bg-no-repeat bg-center [background-size:100%_6px] min-w-0 cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  + ' [&::-webkit-slider-thumb]:h-[13px] [&::-webkit-slider-thumb]:w-[13px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-signal-strong [&::-webkit-slider-thumb]:bg-background'
  + ' [&::-moz-range-thumb]:h-[13px] [&::-moz-range-thumb]:w-[13px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-signal-strong [&::-moz-range-thumb]:bg-background';
