'use client';

import { type ReactNode, useRef } from 'react';
import type { ReferenceView } from '../readiness-reference-ui';
import { ActiveViewErrorBoundary } from './boundaries/active-view-error-boundary';
import { BootstrapBoundary } from './boundaries/bootstrap-boundary';
import { READY_QUERY_STATE, type QueryState } from './boundaries/query-state';
import { LiveRegion } from './live-region';
import { MODULE_TABS, ModuleTabList } from './module-tab-list';
import type { ReadinessBootstrap } from './api/contracts';

interface TechReadinessModuleProps {
  activeView: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  children: ReactNode;
  queryState?: QueryState;
  announcement?: string | null;
  onRetry?: () => void | Promise<void>;
  bootstrap?: ReadinessBootstrap | null;
}

function activeViewState(
  activeView: ReferenceView,
  state: QueryState,
  bootstrap: ReadinessBootstrap | null | undefined,
): QueryState {
  if (state.status !== 'ready' || !bootstrap) return state;
  if (bootstrap.capabilities.screens[activeView]) return state;
  if (activeView === 'shifts' && !bootstrap.featureFlags.readiness_shifts_v1) {
    return { status: 'feature-off', message: 'Смены ещё не включены для этой организации.' };
  }
  if (activeView === 'permits' && !bootstrap.featureFlags.readiness_permits_v1) {
    return { status: 'feature-off', message: 'Наряд-допуски ещё не включены для этой организации.' };
  }
  return {
    status: 'forbidden',
    message: 'Этот раздел недоступен согласно полномочиям, полученным от сервера.',
  };
}

export function TechReadinessModule({
  activeView,
  onViewChange,
  children,
  queryState = READY_QUERY_STATE,
  announcement,
  onRetry,
  bootstrap,
}: TechReadinessModuleProps) {
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const resolvedQueryState = activeViewState(activeView, queryState, bootstrap);

  return (
    <section
      aria-label="Центр технической готовности"
      data-testid="tech-readiness-module"
      className="w-full min-w-0 overflow-x-hidden bg-background"
    >
      <ModuleTabList
        activeView={activeView}
        onViewChange={onViewChange}
        activeTabRef={activeTabRef}
        screens={bootstrap?.capabilities.screens ?? null}
      />
      {MODULE_TABS.map((tab) => {
        const active = tab.id === activeView;
        return (
          <div
            key={tab.id}
            id={`view-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`module-tab-${tab.id}`}
            data-testid={`view-panel-${tab.id}`}
            hidden={!active}
            className="min-w-0"
          >
            {active && (
              <BootstrapBoundary
                state={resolvedQueryState}
                onRetry={onRetry}
                retryFocusRef={activeTabRef}
              >
                <ActiveViewErrorBoundary
                  activeView={activeView}
                  onRetry={() => void onRetry?.()}
                >
                  <div className="min-w-0 [&_.tech-readiness-module]:!min-h-0 [&_.tech-readiness-module]:!overflow-y-visible [&_.tech-readiness-module>div]:!min-h-0 [&_.tech-readiness-module>div>div]:!min-h-0 [&_.tech-readiness-module>div>div]:xl:!h-auto [&_.tech-readiness-module>div>nav]:hidden">
                    {children}
                  </div>
                </ActiveViewErrorBoundary>
              </BootstrapBoundary>
            )}
          </div>
        );
      })}
      <LiveRegion message={announcement} />
    </section>
  );
}
