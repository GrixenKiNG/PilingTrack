'use client';

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import type { ReferenceView } from '../readiness-reference-ui';

/**
 * Иконки здесь не украшение. Восемь одинаковых слов в одну строку читаются
 * подряд, и человек каждый раз ищет нужное перечитыванием. Внутренняя
 * навигация модуля (`readiness-reference-ui`, VIEW_ITEMS) иконки уже носит —
 * эта полоса просто не получила их при выносе в администраторскую оболочку.
 */
export type ModuleTab = { id: ReferenceView; label: string; icon: PilingIconName };

/**
 * Вкладки «Техготовности» — модуль про ТЕХНИКУ.
 *
 * Раньше здесь же жили вкладки про людей: документы работников, журнал
 * инструктажей, наряды-допуски. Решение владельца 13.09.2026 — развести
 * технику и охрану труда по разным модулям, чтобы не путаться: всё людское
 * переехало в «ТБ и допуски» (`SAFETY_TABS`, маршрут `/admin/safety`).
 */
export const MODULE_TABS = [
  { id: 'readiness', label: 'Центр готовности', icon: 'technical-readiness' },
  { id: 'fleet', label: 'Готовность парка', icon: 'equipment-rig' },
  { id: 'shifts', label: 'Смены', icon: 'shift-start' },
  { id: 'maintenance', label: 'Обслуживание', icon: 'repair' },
  { id: 'reports', label: 'Отчёты', icon: 'reports' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
] as const satisfies ReadonlyArray<ModuleTab>;

/**
 * Вкладки модуля «ТБ и допуски» — всё про ЛЮДЕЙ.
 *
 * Порядок — от вопроса «кого нельзя пускать сегодня» к подробностям и
 * истории: сводка, бумаги, журнал инструктажей, разбор происшествий и в конце
 * реестр нарядов (в ОРИОН их не выписывают, см. `readiness-rules.ts`).
 */
export const SAFETY_TABS = [
  // «Мой допуск» открыт КАЖДОЙ роли и стоит первым: модуль доступен всем,
  // потому что инструктаж проходит каждый, а остальные вкладки — рабочее
  // место инженера ОТ. Без личного раздела «доступ для всех» означал бы
  // модуль, где все вкладки отвечают отказом.
  { id: 'my-clearance', label: 'Мой допуск', icon: 'operator' },
  { id: 'safety', label: 'Обзор', icon: 'accepted' },
  { id: 'documents', label: 'Документы', icon: 'documents' },
  { id: 'briefings', label: 'Журнал инструктажей', icon: 'risk' },
  { id: 'incidents', label: 'Происшествия', icon: 'defect' },
  { id: 'permits', label: 'Наряд-допуски', icon: 'work-order' },
] as const satisfies ReadonlyArray<ModuleTab>;

interface ModuleTabListProps {
  activeView: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  activeTabRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Экраны, разрешённые ролью. Недоступные вкладки не показываем: раньше
   * оператор видел все семь, а «Отчёты» и «Настройки» отвечали ему
   * «Недостаточно прав». Пока прав нет, показываем весь список.
   */
  screens?: Record<ReferenceView, boolean> | null;
  /** Контрол в правом конце полосы (переключатель исполняемой роли). */
  trailing?: React.ReactNode;
  /** Набор вкладок модуля. По умолчанию — «Техготовность». */
  tabs?: ReadonlyArray<ModuleTab>;
  /** Чем подписана полоса для скринридера. */
  ariaLabel?: string;
}

export function ModuleTabList({
  activeView,
  onViewChange,
  activeTabRef,
  screens,
  trailing,
  tabs: moduleTabs = MODULE_TABS,
  ariaLabel = 'Техническая готовность',
}: ModuleTabListProps) {
  const localRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = screens ? moduleTabs.filter((tab) => screens[tab.id] !== false) : moduleTabs;

  useEffect(() => {
    const activeTab = localRefs.current[tabs.findIndex((tab) => tab.id === activeView)];
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeView, tabs]);

  const focusTab = (index: number) => {
    localRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusTab(nextIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onViewChange(tabs[index].id);
    }
  };

  return (
    <nav
      aria-label={`Разделы модуля: ${ariaLabel}`}
      // Полоса вкладок светлая, как везде в приложении. Раньше здесь была
      // тёмная `bg-primary text-white` — она пришла из макета, где модуль был
      // отдельным приложением со своим чёрным топбаром. Внутри нашей
      // администраторской оболочки это читалось как вторая, чужая навигация.
      className="flex h-12 min-w-0 items-center overflow-hidden border-b border-border bg-card"
    >
      <div
        role="tablist"
        aria-label={ariaLabel}
        data-testid="module-tabs"
        data-scroll-region="module-tabs"
        className="flex h-12 min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeView;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                localRefs.current[index] = node;
                if (selected && activeTabRef) {
                  activeTabRef.current = node;
                }
              }}
              id={`module-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`view-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`module-tab-${tab.id}`}
              onClick={() => onViewChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'relative flex h-12 min-h-9 flex-none items-center gap-1.5 whitespace-nowrap px-3 text-sm outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 max-sm:min-h-11',
                selected
                  ? 'font-semibold text-foreground'
                  : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <PilingIcon
                name={tab.icon}
                size={14}
                tone={selected ? 'primary' : 'neutral'}
                decorative
              />
              {tab.label}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-0.5 bg-signal"
                />
              )}
            </button>
          );
        })}
      </div>
      {trailing}
    </nav>
  );
}
