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

export function ToModule() {
  const workspaceLoadStarted = useRef(false);
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
  });
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceIssues, setWorkspaceIssues] = useState<WorkspaceIssue[]>([]);
  const [rulesAvailable, setRulesAvailable] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL deep-link is the source of initial tab state
    setView(parseView(params.get('view')));
    setSettingsSection(parseSettingsSection(params.get('section')));
    const requestedEquipment = params.get('equipmentId');
    if (requestedEquipment) setEquipmentId(requestedEquipment);
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setWorkspaceError(null);
    setWorkspaceIssues([]);
    setRulesAvailable(false);
    try {
      const [
        equipmentResponse,
        crewResult,
        maintenanceResult,
        fleetResult,
        readinessRulesResult,
      ] = await Promise.all([
        authFetch('/api/equipment?limit=100'),
        readOptionalCollectionWithIssue<CrewSummary>(
          '/api/crews?limit=100',
          'data',
          'Бригады',
        ),
        readOptionalCollectionWithIssue<MaintenanceSummary>(
          '/api/maintenance',
          'records',
          'Обслуживание',
        ),
        readOptionalJsonWithIssue<FleetSnapshot>(
          '/api/monitoring/fleet',
          'Мониторинг парка',
        ),
        readOptionalJsonWithIssue<ReadinessRulesState>(
          '/api/readiness-rules',
          'Правила готовности',
        ),
      ]);
      if (!equipmentResponse.ok) {
        const message = equipmentResponse.status === 403
          ? 'Недостаточно прав для просмотра установок.'
          : equipmentResponse.status === 429
            ? 'Слишком много запросов. Подождите минуту и повторите загрузку.'
            : equipmentResponse.status === 401
              ? 'Сессия завершена. Войдите в приложение повторно.'
              : `Список установок временно недоступен (код ${equipmentResponse.status}).`;
        throw new Error(message);
      }
      const equipmentBody = await equipmentResponse.json() as { data?: unknown };
      const list = Array.isArray(equipmentBody.data)
        ? equipmentBody.data as EquipmentOption[]
        : [];
      const crewList = crewResult.data;
      const maintenanceList = maintenanceResult.data;
      const fleetSnapshot = fleetResult.data;
      const readinessRules = readinessRulesResult.data;
      setRulesAvailable(readinessRules !== null);
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

      const [primaryJournal, primaryDetail] = await Promise.all([
        readOptionalJsonWithIssue<{ records?: JournalRecord[] }>(
          `/api/to/journal?equipmentId=${encodeURIComponent(primaryEquipment.id)}`,
          `Журнал «${primaryEquipment.name}»`,
        ),
        readOptionalJsonWithIssue<EquipmentDetailSnapshot>(
          `/api/equipment/${encodeURIComponent(primaryEquipment.id)}/details`,
          `Карточка «${primaryEquipment.name}»`,
        ),
      ]);
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

      const backgroundItems = list.filter((item) => item.id !== primaryEquipment.id);
      const journalPairs: Array<readonly [string, JournalRecord[], boolean]> = [];
      const detailPairs: Array<readonly [string, EquipmentDetailSnapshot | null]> = [];

      for (let offset = 0; offset < backgroundItems.length; offset += 4) {
        const batch = backgroundItems.slice(offset, offset + 4);
        const batchPairs = await Promise.all(batch.map(async (item) => {
          const [journal, detail] = await Promise.all([
            readOptionalJson<{ records?: JournalRecord[] }>(
              `/api/to/journal?equipmentId=${encodeURIComponent(item.id)}`,
            ),
            readOptionalJson<EquipmentDetailSnapshot>(
              `/api/equipment/${encodeURIComponent(item.id)}/details`,
            ),
          ]);
          return {
            journal: [item.id, journal?.records ?? [], journal != null] as const,
            detail: [item.id, detail] as const,
          };
        }));
        journalPairs.push(...batchPairs.map((pair) => pair.journal));
        detailPairs.push(...batchPairs.map((pair) => pair.detail));
      }

      setDetails((previous) => detailPairs.reduce<Record<string, EquipmentDetailSnapshot>>(
        (result, [id, detail]) => {
          if (detail) result[id] = detail;
          return result;
        },
        { ...previous },
      ));
      setJournals((previous) => ({
        ...previous,
        ...Object.fromEntries(journalPairs.map(([id, records]) => [id, records])),
      }));
      setJournalLoaded((previous) => ({
        ...previous,
        ...Object.fromEntries(journalPairs.map(([id, , loaded]) => [id, loaded])),
      }));
      const failedJournals = journalPairs.filter(([, , loaded]) => !loaded).length;
      if (failedJournals > 0) toast.warning(`Не удалось загрузить журналов: ${failedJournals}`);
    } catch (error) {
      setWorkspaceError(
        !navigator.onLine
          ? 'Нет подключения к сети. Подключитесь к интернету и повторите запрос.'
          : error instanceof Error
            ? error.message
            : 'Не удалось загрузить список установок. Проверьте доступность сервера и повторите запрос.',
      );
      toast.error('Не удалось загрузить центр технической готовности');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workspaceLoadStarted.current) return;
    workspaceLoadStarted.current = true;
    void loadWorkspace();
  }, [loadWorkspace]);

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

  return (
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
      onRetry={() => void loadWorkspace()}
    />
  );
}
