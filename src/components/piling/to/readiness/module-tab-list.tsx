'use client';

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
} from 'react';
import type { ReferenceView } from '../readiness-reference-ui';

export const MODULE_TABS = [
  { id: 'readiness', label: 'Центр готовности' },
  { id: 'fleet', label: 'Техника' },
  { id: 'shifts', label: 'Смены' },
  { id: 'permits', label: 'Наряд-допуски' },
  { id: 'maintenance', label: 'Обслуживание' },
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
}

export function ModuleTabList({
  activeView,
  onViewChange,
  activeTabRef,
  screens,
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
      className="h-12 min-w-0 overflow-hidden bg-primary text-white"
    >
      <div
        role="tablist"
        aria-label="Техническая готовность"
        data-testid="module-tabs"
        data-scroll-region="module-tabs"
        className="flex h-12 w-full min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]"
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
              className="relative flex h-12 min-h-9 flex-none items-center whitespace-nowrap px-3 text-sm font-semibold text-white/80 outline-none transition-colors hover:bg-card/10 hover:text-white focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal sm:px-4 max-sm:min-h-11"
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
    </nav>
  );
}
