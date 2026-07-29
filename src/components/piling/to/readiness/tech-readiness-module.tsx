'use client';

import { type ReactNode, useRef } from 'react';
import type { ReferenceView } from '../readiness-reference-ui';
import { ActiveViewErrorBoundary } from './boundaries/active-view-error-boundary';
import { BootstrapBoundary } from './boundaries/bootstrap-boundary';
import { READY_QUERY_STATE, type QueryState } from './boundaries/query-state';
import { LiveRegion } from './live-region';
import { MODULE_TABS, ModuleTabList } from './module-tab-list';

interface TechReadinessModuleProps {
  activeView: ReferenceView;
  onViewChange: (view: ReferenceView) => void;
  children: ReactNode;
  queryState?: QueryState;
  announcement?: string | null;
  onRetry?: () => void | Promise<void>;
}

export function TechReadinessModule({
  activeView,
  onViewChange,
  children,
  queryState = READY_QUERY_STATE,
  announcement,
  onRetry,
}: TechReadinessModuleProps) {
  const activeTabRef = useRef<HTMLButtonElement>(null);

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
                state={queryState}
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
