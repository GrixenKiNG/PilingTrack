import { TECH_READINESS_PRODUCTION_SHELL_ENABLED, type ModuleSurface, SURFACE_TABS, SURFACE_LABEL } from './to-module-config';
import { TechReadinessModule } from './readiness/tech-readiness-module';
import { InspectionLayer } from './inspection-layer';
import type { QueryState } from './readiness/boundaries/query-state';
import { ReadinessApiError } from './readiness/api/errors';
import { ReadinessReferenceUi } from './readiness-reference-ui';
import type { ReferenceUiProps } from './readiness/screens/types';

interface ToModuleViewProps {
  surface: ModuleSurface;
  bootstrapError: ReadinessApiError | null;
  referenceUiProps: ReferenceUiProps;
  loadWorkspace: () => Promise<void>;
}

export function ToModuleView({ surface, bootstrapError, referenceUiProps, loadWorkspace }: ToModuleViewProps) {

  const { view, onViewChange: changeView, bootstrap, loading, workspaceError } = referenceUiProps;
  const referenceUi = <ReadinessReferenceUi {...referenceUiProps} />;

  if (!TECH_READINESS_PRODUCTION_SHELL_ENABLED) return referenceUi;

  const queryState: QueryState = bootstrapError
    ? bootstrapError.code === 'FORBIDDEN' || bootstrapError.code === 'UNAUTHORIZED'
      ? { status: 'forbidden', message: bootstrapError.message }
      : { status: 'error', message: bootstrapError.message }
    : loading || !bootstrap
      ? { status: 'loading' }
      : workspaceError
        ? { status: 'error', message: workspaceError }
        : { status: 'ready' };

  return (
    <InspectionLayer>
    <TechReadinessModule
      activeView={view}
      onViewChange={changeView}
      queryState={queryState}
      bootstrap={bootstrap}
      tabs={SURFACE_TABS[surface]}
      moduleLabel={SURFACE_LABEL[surface]}
      announcement={
        workspaceError
          ? `Ошибка загрузки: ${workspaceError}`
          : loading
            ? `Загрузка модуля: ${SURFACE_LABEL[surface]}`
            : `Открыт раздел ${view}`
      }
      onRetry={bootstrapError?.retryable === false ? undefined : loadWorkspace}
    >
      {referenceUi}
    </TechReadinessModule>
    </InspectionLayer>
  );

}
