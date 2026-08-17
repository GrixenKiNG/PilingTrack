'use client';

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import type { ReferenceView } from '../readiness-reference-ui';

export const MODULE_TABS = [
  { id: 'readiness', label: 'Центр готовности' },
  { id: 'fleet', label: 'Техника' },
  { id: 'shifts', label: 'Смены' },
  { id: 'permits', label: 'Наряд-допуски' },
  { id: 'maintenance', label: 'Обслуживание' },
  { id: 'documents', label: 'Документы' },
  { id: 'reports', label: 'Отчёты' },
  { id: 'settings', label: 'Настройки' },
] as const satisfies ReadonlyArray<{ id: ReferenceView; label: string }>;

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
}

export function ModuleTabList({
  activeView,
  onViewChange,
  activeTabRef,
  screens,
  trailing,
}: ModuleTabListProps) {
  const localRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = screens ? MODULE_TABS.filter((tab) => screens[tab.id] !== false) : MODULE_TABS;

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
      aria-label="Разделы технической готовности"
      // Полоса вкладок светлая, как везде в приложении. Раньше здесь была
      // тёмная `bg-primary text-white` — она пришла из макета, где модуль был
      // отдельным приложением со своим чёрным топбаром. Внутри нашей
      // администраторской оболочки это читалось как вторая, чужая навигация.
      className="flex h-12 min-w-0 items-center overflow-hidden border-b border-border bg-card"
    >
      <div
        role="tablist"
        aria-label="Техническая готовность"
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
                'relative flex h-12 min-h-9 flex-none items-center whitespace-nowrap px-3 text-sm outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 max-sm:min-h-11',
                selected
                  ? 'font-semibold text-foreground'
                  : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
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
