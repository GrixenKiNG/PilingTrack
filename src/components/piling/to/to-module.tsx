'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { authFetch } from '@/lib/api';
import {
  DEFAULT_READINESS_RULES,
  buildReadinessFacts,
  computeReadinessScore,
  type ReadinessFacts,
  type ReadinessRulesState,
  type ReadinessScoreResult,
} from '@/modules/readiness';
import type { CrewSummary, MaintenanceSummary } from './readiness-design-views';
import { TechReadinessModule } from './readiness/tech-readiness-module';
import type { QueryState } from './readiness/boundaries/query-state';
import {
  fetchCurrentReadiness,
  fetchReadinessAudit,
  fetchReadinessBootstrap,
  fetchReadinessHistory,
  fetchReadinessShifts,
  fetchWorkPermits,
  type ReadinessUrlFilters,
} from './readiness/api/client';
import type {
  CurrentReadinessDto,
  ReadinessAuditEnvelope,
  ReadinessBootstrap,
  ReadinessShiftDto,
  ReadinessSnapshotDto,
  WorkPermitDto,
} from './readiness/api/contracts';
import {
  ReadinessApiError,
  isReadinessRequestCancelled,
} from './readiness/api/errors';
import {
  ReadinessReferenceUi,
  type EquipmentDetailSnapshot,
  type ReferenceView,
  type SettingsSection,
} from './readiness-reference-ui';
import {
  deriveEquipmentReadiness,
  type EquipmentReadiness,
} from './readiness-model';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';

const VIEW_IDS = new Set<ReferenceView>([
  'readiness',
  'fleet',
  'shifts',
  'permits',
  'maintenance',
  'reports',
  'settings',
]);

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

const parseView = (value: string | null): ReferenceView => {
  if (value === 'journal' || value === 'meters' || value === 'plans') return 'maintenance';
  return value && VIEW_IDS.has(value as ReferenceView) ? value as ReferenceView : 'readiness';
};

const parseSettingsSection = (value: string | null): SettingsSection =>
  value && SETTINGS_IDS.has(value as SettingsSection) ? value as SettingsSection : 'rules';

async function readOptionalJson<T>(url: string): Promise<T | null> {
  try {
    const response = await authFetch(url);
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

interface WorkspaceIssue {
  source: string;
  message: string;
}

async function readOptionalCollectionWithIssue<T>(
  url: string,
  field: 'data' | 'records',
  source: string,
): Promise<{ data: T[]; issue: WorkspaceIssue | null }> {
  const result = await readOptionalJsonWithIssue<Record<string, unknown>>(url, source);
  if (!result.data) return { data: [], issue: result.issue };
  return Array.isArray(result.data[field])
    ? { data: result.data[field] as T[], issue: null }
    : {
        data: [],
        issue: {
          source,
          message: 'Сервер вернул данные в неподдерживаемом формате.',
        },
      };
}

async function readOptionalJsonWithIssue<T>(
  url: string,
  source: string,
): Promise<{ data: T | null; issue: WorkspaceIssue | null }> {
  try {
    const response = await authFetch(url);
    if (!response.ok) {
      return {
        data: null,
        issue: {
          source,
          message: response.status === 403
            ? 'Недостаточно прав для загрузки данных.'
            : response.status === 429
              ? 'Слишком много запросов. Повторите через минуту.'
              : `Источник временно недоступен (код ${response.status}).`,
        },
      };
    }
    return { data: await response.json() as T, issue: null };
  } catch {
    return {
      data: null,
      issue: {
        source,
        message: navigator.onLine
          ? 'Не удалось получить ответ от сервера.'
          : 'Нет подключения к сети.',
      },
    };
  }
}

async function readAuthoritativeCollection<T>(
  request: Promise<T[]>,
): Promise<{data: T[]; error: string | null}> {
  try {
    return {data: await request, error: null};
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error
        ? error.message
        : 'Авторитетная оценка недоступна.',
    };
  }
}

export function ToModule() {
  const workspaceRequest = useRef<AbortController | null>(null);
  const [bootstrap, setBootstrap] = useState<ReadinessBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<ReadinessApiError | null>(null);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [journals, setJournals] = useState<Record<string, JournalRecord[]>>({});
  const [journalLoaded, setJournalLoaded] = useState<Record<string, boolean>>({});
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceSummary[]>([]);
  const [fleetCards, setFleetCards] = useState<FleetCard[]>([]);
  const [details, setDetails] = useState<Record<string, EquipmentDetailSnapshot>>({});
  const [view, setView] = useState<ReferenceView>('readiness');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('rules');
  const [rulesState, setRulesState] = useState<ReadinessRulesState>({
    published: DEFAULT_READINESS_RULES,
    draft: null,
    pendingChanges: 0,
    publishedInDb: false,
  });
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceIssues, setWorkspaceIssues] = useState<WorkspaceIssue[]>([]);
  const [rulesAvailable, setRulesAvailable] = useState(false);
  const [shifts, setShifts] = useState<ReadinessShiftDto[]>([]);
  const [permits, setPermits] = useState<WorkPermitDto[]>([]);
  const [currentReadiness, setCurrentReadiness] = useState<CurrentReadinessDto[]>([]);
  const [readinessHistory, setReadinessHistory] = useState<ReadinessSnapshotDto[]>([]);
  const [authoritativeReadinessError, setAuthoritativeReadinessError] = useState<string | null>(null);
  const [audit, setAudit] = useState<ReadinessAuditEnvelope | null>(null);
  const [readinessFilters, setReadinessFilters] = useState<ReadinessUrlFilters>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL deep-link is the source of initial tab state
    setView(parseView(params.get('view')));
    setSettingsSection(parseSettingsSection(params.get('section')));
    const requestedEquipment = params.get('equipmentId');
    if (requestedEquipment) setEquipmentId(requestedEquipment);
    const nextFilters: ReadinessUrlFilters = {};
    for (const key of ['status', 'from', 'to', 'shiftType', 'risk', 'eventType', 'actor'] as const) {
      const value = params.get(key);
      if (value) (nextFilters as Record<string, string>)[key] = value;
    }
    setReadinessFilters(nextFilters);
  }, []);

  const loadWorkspace = useCallback(async () => {
    workspaceRequest.current?.abort();
    const controller = new AbortController();
    workspaceRequest.current = controller;
    setLoading(true);
    setBootstrapError(null);
    setWorkspaceError(null);
    setWorkspaceIssues([]);
    setAuthoritativeReadinessError(null);
    setRulesAvailable(false);
    try {
      let readinessBootstrap = await fetchReadinessBootstrap({ signal: controller.signal });
      if (readinessBootstrap.actor.role === 'ADMIN' && readinessBootstrap.capabilities.canActAsMechanic) {
        readinessBootstrap = await fetchReadinessBootstrap({ signal: controller.signal, actingAsMechanic: true });
      }
      if (controller.signal.aborted) return;
      setBootstrap(readinessBootstrap);
      const canReadLegacyAdminData = readinessBootstrap.actor.role !== 'OPERATOR';
      const [
        equipmentResponse,
        crewResult,
        maintenanceResult,
        fleetResult,
        readinessRulesResult,
        shiftsResult,
        permitsResult,
        currentResult,
        historyResult,
        auditResult,
      ] = await Promise.all([
        canReadLegacyAdminData ? authFetch('/api/equipment?limit=100') : Promise.resolve(null),
        canReadLegacyAdminData ? readOptionalCollectionWithIssue<CrewSummary>(
          '/api/crews?limit=100',
          'data',
          'Бригады',
        ) : Promise.resolve({ data: [] as CrewSummary[], issue: null }),
        canReadLegacyAdminData ? readOptionalCollectionWithIssue<MaintenanceSummary>(
          '/api/maintenance',
          'records',
          'Обслуживание',
        ) : Promise.resolve({ data: [] as MaintenanceSummary[], issue: null }),
        canReadLegacyAdminData ? readOptionalJsonWithIssue<FleetSnapshot>(
          '/api/monitoring/fleet',
          'Мониторинг парка',
        ) : Promise.resolve({ data: null, issue: null }),
        readOptionalJsonWithIssue<ReadinessRulesState>(
          '/api/readiness-rules',
          'Правила готовности',
        ),
        fetchReadinessShifts(controller.signal, readinessFilters).catch(() => []),
        fetchWorkPermits(controller.signal, readinessFilters).catch(() => []),
        readAuthoritativeCollection(fetchCurrentReadiness(controller.signal, readinessFilters)),
        readAuthoritativeCollection(fetchReadinessHistory(controller.signal, readinessFilters)),
        readinessBootstrap.capabilities.entities.audit.read
          ? fetchReadinessAudit(controller.signal, readinessFilters).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (equipmentResponse && !equipmentResponse.ok) {
        const message = equipmentResponse.status === 403
          ? 'Недостаточно прав для просмотра установок.'
          : equipmentResponse.status === 429
            ? 'Слишком много запросов. Подождите минуту и повторите загрузку.'
            : equipmentResponse.status === 401
              ? 'Сессия завершена. Войдите в приложение повторно.'
              : `Список установок временно недоступен (код ${equipmentResponse.status}).`;
        throw new Error(message);
      }
      const equipmentBody = equipmentResponse
        ? await equipmentResponse.json() as { data?: unknown }
        : { data: [] };
      const allowedEquipmentIds = new Set(
        readinessBootstrap.selectors.equipment.map((item) => item.id),
      );
      const equipmentFromModule = (Array.isArray(equipmentBody.data)
        ? equipmentBody.data as EquipmentOption[]
        : []).filter((item) => allowedEquipmentIds.has(item.id));
      const list = equipmentFromModule.length > 0
        ? equipmentFromModule
        : readinessBootstrap.selectors.equipment.map((item): EquipmentOption => ({
            id: item.id,
            name: item.name,
            model: item.model,
            hammerKind: 'NONE',
            isCombined: false,
            isActive: true,
            crewCount: 0,
          }));
      const crewList = crewResult.data;
      const maintenanceList = maintenanceResult.data;
      const fleetSnapshot = fleetResult.data;
      const readinessRules = readinessRulesResult.data;
      setRulesAvailable(readinessRules !== null);
      setShifts(shiftsResult);
      setPermits(permitsResult);
      setCurrentReadiness(currentResult.data);
      setReadinessHistory(historyResult.data);
      setAuthoritativeReadinessError(currentResult.error ?? historyResult.error);
      setAudit(auditResult);
      const initialIssues = [
        crewResult.issue,
        maintenanceResult.issue,
        fleetResult.issue,
        readinessRulesResult.issue,
      ].filter((issue): issue is WorkspaceIssue => issue !== null);
      if (initialIssues.length > 0) setWorkspaceIssues(initialIssues);
      const requestedId = new URLSearchParams(window.location.search).get('equipmentId');
      const primaryEquipment = list.find((item) => item.id === requestedId) ?? list[0];

      if (!primaryEquipment) {
        setEquipment([]);
        setCrews(crewList);
        setMaintenance(maintenanceList);
        setFleetCards(fleetSnapshot?.equipment ?? []);
        if (readinessRules) setRulesState(readinessRules);
        setLoading(false);
        return;
      }

      const [primaryJournal, primaryDetail] = canReadLegacyAdminData ? await Promise.all([
        readOptionalJsonWithIssue<{ records?: JournalRecord[] }>(
          `/api/to/journal?equipmentId=${encodeURIComponent(primaryEquipment.id)}`,
          `Журнал «${primaryEquipment.name}»`,
        ),
        readOptionalJsonWithIssue<EquipmentDetailSnapshot>(
          `/api/equipment/${encodeURIComponent(primaryEquipment.id)}/details`,
          `Карточка «${primaryEquipment.name}»`,
        ),
      ]) : [
        { data: null, issue: null },
        { data: null, issue: null },
      ];
      const primaryIssues = [primaryJournal.issue, primaryDetail.issue]
        .filter((issue): issue is WorkspaceIssue => issue !== null);
      if (primaryIssues.length > 0) {
        setWorkspaceIssues((current) => [...current, ...primaryIssues]);
      }

      setEquipment(list);
      setCrews(crewList);
      setMaintenance(maintenanceList);
      setFleetCards(fleetSnapshot?.equipment ?? []);
      if (readinessRules) setRulesState(readinessRules);
      setEquipmentId(primaryEquipment.id);
      setDetails(primaryDetail.data ? { [primaryEquipment.id]: primaryDetail.data } : {});
      setJournals({ [primaryEquipment.id]: primaryJournal.data?.records ?? [] });
      setJournalLoaded({ [primaryEquipment.id]: primaryJournal.data != null });
      setLoading(false);

    } catch (error) {
      if (isReadinessRequestCancelled(error) || controller.signal.aborted) return;
      if (error instanceof ReadinessApiError) setBootstrapError(error);
      setWorkspaceError(
        !navigator.onLine
          ? 'Нет подключения к сети. Подключитесь к интернету и повторите запрос.'
          : error instanceof Error
            ? error.message
            : 'Не удалось загрузить список установок. Проверьте доступность сервера и повторите запрос.',
      );
      toast.error('Не удалось загрузить центр технической готовности');
    } finally {
      if (workspaceRequest.current === controller && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [readinessFilters]);

  useEffect(() => {
    void loadWorkspace();
    return () => workspaceRequest.current?.abort();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!equipmentId || bootstrap?.actor.role === 'OPERATOR' || journalLoaded[equipmentId] || details[equipmentId]) return;
    let active = true;
    void Promise.all([
      readOptionalJson<{ records?: JournalRecord[] }>(`/api/to/journal?equipmentId=${encodeURIComponent(equipmentId)}`),
      readOptionalJson<EquipmentDetailSnapshot>(`/api/equipment/${encodeURIComponent(equipmentId)}/details`),
    ]).then(([journal, detail]) => {
      if (!active) return;
      setJournals((previous) => ({ ...previous, [equipmentId]: journal?.records ?? [] }));
      setJournalLoaded((previous) => ({ ...previous, [equipmentId]: true }));
      if (detail) setDetails((previous) => ({ ...previous, [equipmentId]: detail }));
    });
    return () => { active = false; };
  }, [bootstrap?.actor.role, details, equipmentId, journalLoaded]);

  const readinessByEquipment = useMemo(() => {
    const entries = equipment.map((item) => [
      item.id,
      deriveEquipmentReadiness(
        item,
        journals[item.id] ?? [],
        journalLoaded[item.id] === true,
      ),
    ] as const);
    return Object.fromEntries(entries) as Record<string, EquipmentReadiness>;
  }, [equipment, journalLoaded, journals]);

  const factsByEquipment = useMemo(() => Object.fromEntries(
    equipment.map((item) => [
      item.id,
      buildReadinessFacts({
        equipment: item,
        records: journals[item.id] ?? [],
      }),
    ]),
  ) as Record<string, ReadinessFacts>, [equipment, journals]);

  const scoresByEquipment = useMemo(() => Object.fromEntries(
    equipment.map((item) => [
      item.id,
      computeReadinessScore(
        factsByEquipment[item.id],
        rulesState.published,
      ),
    ]),
  ) as Record<string, ReadinessScoreResult>, [
    equipment,
    factsByEquipment,
    rulesState.published,
  ]);

  const replaceUrlState = (
    nextView: ReferenceView,
    nextSection: SettingsSection,
    nextEquipmentId = equipmentId,
  ) => {
    const url = new URL(window.location.href);
    if (nextView === 'readiness') url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    if (nextView === 'settings') url.searchParams.set('section', nextSection);
    else url.searchParams.delete('section');
    if (nextEquipmentId) url.searchParams.set('equipmentId', nextEquipmentId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const changeView = (next: ReferenceView) => {
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

  const referenceUi = (
    <ReadinessReferenceUi
      view={view}
      onViewChange={changeView}
      settingsSection={settingsSection}
      onSettingsSectionChange={changeSettingsSection}
      equipment={equipment}
      selectedId={equipmentId}
      onSelect={changeEquipment}
      readinessByEquipment={readinessByEquipment}
      factsByEquipment={factsByEquipment}
      scoresByEquipment={scoresByEquipment}
      rulesState={rulesState}
      onRulesStateChange={setRulesState}
      journals={journals}
      crews={crews}
      maintenance={maintenance}
      fleetCards={fleetCards}
      details={details}
      loading={loading}
      workspaceError={workspaceError}
      workspaceIssues={workspaceIssues}
      rulesAvailable={rulesAvailable}
      bootstrap={bootstrap}
      shifts={shifts}
      permits={permits}
      currentReadiness={currentReadiness}
      authoritativeReadinessError={authoritativeReadinessError}
      readinessHistory={readinessHistory}
      audit={audit}
      filters={readinessFilters}
      onFiltersChange={changeReadinessFilters}
      showInternalNavigation={!TECH_READINESS_PRODUCTION_SHELL_ENABLED}
      onRetry={() => void loadWorkspace()}
    />
  );

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
    <TechReadinessModule
      activeView={view}
      onViewChange={changeView}
      queryState={queryState}
      bootstrap={bootstrap}
      announcement={
        workspaceError
          ? `Ошибка загрузки: ${workspaceError}`
          : loading
            ? 'Загрузка центра технической готовности'
            : `Открыт раздел ${view}`
      }
      onRetry={bootstrapError?.retryable === false ? undefined : loadWorkspace}
    >
      {referenceUi}
    </TechReadinessModule>
  );
}
