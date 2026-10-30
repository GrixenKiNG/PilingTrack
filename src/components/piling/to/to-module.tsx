'use client';

import { loadToWorkspace } from './to-workspace-load';
import { loadSelectedToEquipment } from './to-selected-equipment';
import { buildToReadinessMap } from './to-readiness-map';
import { createToNavigation } from './to-navigation';
import { ToModuleView } from './to-module-view';

import { type WorkspaceIssue } from './to-module-data';

import { TECH_READINESS_PRODUCTION_SHELL_ENABLED, type ModuleSurface, SURFACE_TABS, SURFACE_ROUTE, SURFACE_LABEL, SURFACE_HOME, surfaceOfView, parseView, parseSettingsSection } from './to-module-config';
export { TECH_READINESS_PRODUCTION_SHELL_ENABLED } from './to-module-config';
export type { ModuleSurface } from './to-module-config';

import { usePilingStore } from '@/lib/store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDocumentTitle } from '@/components/piling/ops-shell';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';

import {
  DEFAULT_READINESS_RULES,
  buildReadinessFacts,
  computeReadinessScore,
  type ReadinessFacts,
  type ReadinessRulesState,
  type ReadinessScoreResult,
} from '@/modules/readiness';
import type { CrewSummary, MaintenanceSummary } from './readiness-design-views';
import type { ActingRole } from '@/lib/types';



import { fetchWorkPermitsPage, type WorkPermitsPage, type ReadinessUrlFilters } from './readiness/api/client';
import type {
  CurrentReadinessDto,
  ReadinessAuditEnvelope,
  ReadinessBootstrap,
  ReadinessShiftDto,
  ReadinessSnapshotDto,
  WorkPermitDto,
  DefectDto,
} from './readiness/api/contracts';
import { ReadinessApiError } from './readiness/api/errors';
import { type EquipmentDetailSnapshot, type ReferenceView, type SettingsSection } from './readiness-reference-ui';


import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
// Та же матрица прав, по которой откажет сервер. Модуль чистый — ни базы,
// ни серверных зависимостей, — поэтому безопасен в клиентской сборке.



export function ToModule({ surface = 'readiness' }: { surface?: ModuleSurface } = {}) {
  useDocumentTitle(SURFACE_LABEL[surface]);
  const workspaceRequest = useRef<AbortController | null>(null);
  // Раздел назван в адресе — значит выбран человеком, и подменять его нельзя.
  const viewPinnedByUrl = useRef(false);
  const [bootstrap, setBootstrap] = useState<ReadinessBootstrap | null>(null);
  // Роль, которую администратор исполняет. null — работает как администратор.
  // MECHANIC по умолчанию сохраняет прежнее поведение: раньше модуль включал
  // этот режим сам, без ведома пользователя.
  // Исполняемая роль живёт в общем store, а не в состоянии этого экрана:
  // режим меняет навигацию и права во всём приложении, и `authFetch` берёт
  // значение оттуда же, чтобы подставить заголовок на каждом запросе. Пока
  // значение было локальным, «Действую как» действовало только здесь.
  const actingAs = usePilingStore((state) => state.actingAs) as ActingRole | null;
  const [bootstrapError, setBootstrapError] = useState<ReadinessApiError | null>(null);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [journals, setJournals] = useState<Record<string, JournalRecord[]>>({});
  const [journalLoaded, setJournalLoaded] = useState<Record<string, boolean>>({});
  // Какие источники выбранной установки уже спрашивали (журнал/карточка).
  // Отдельно от «загружено»: отказ — это тоже попытка, и без такой отметки
  // эффект догрузки зациклился бы на повторных запросах к упавшему источнику.
  const [loadAttempts, setLoadAttempts] = useState<
    Record<string, { journal: boolean; card: boolean }>
  >({});
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceSummary[]>([]);
  const [fleetCards, setFleetCards] = useState<FleetCard[]>([]);
  const [details, setDetails] = useState<Record<string, EquipmentDetailSnapshot>>({});
  const [view, setView] = useState<ReferenceView>(SURFACE_HOME[surface]);
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
  // Источники, закрытые ролью, а не сбоем: показывать их ни пустотой, ни
  // строкой «временно недоступно» с кнопкой повтора нельзя — повтор не поможет.
  const [outOfRoleSources, setOutOfRoleSources] = useState<string[]>([]);
  const [rulesAvailable, setRulesAvailable] = useState(false);
  const [shifts, setShifts] = useState<ReadinessShiftDto[]>([]);
  const [permits, setPermits] = useState<WorkPermitDto[]>([]);
  // Сервер отдаёт наряды страницами по 200: итог и курсор нужны экрану, чтобы
  // не выдавать первую страницу за весь список.
  const [permitsPage, setPermitsPage] = useState<Pick<WorkPermitsPage, 'total' | 'hasMore' | 'nextCursor'>>(
    { total: 0, hasMore: false, nextCursor: null },
  );
  const [defects, setDefects] = useState<DefectDto[]>([]);
  // Отказ чтения дефектов — отдельный источник (F-N1005-DEFECTS-UNKNOWN).
  // Пустой `defects` при этом значит «не прочитано», а не «замечаний нет»:
  // счётчик критических дефектов влияет на допуск установки.
  const [defectsError, setDefectsError] = useState<string | null>(null);
  // То же для нарядов: пустой список при отказе — «не загрузились», не «не найдены».
  const [permitsError, setPermitsError] = useState<string | null>(null);
  const [currentReadiness, setCurrentReadiness] = useState<CurrentReadinessDto[]>([]);
  const [readinessHistory, setReadinessHistory] = useState<ReadinessSnapshotDto[]>([]);
  const [authoritativeReadinessError, setAuthoritativeReadinessError] = useState<string | null>(null);
  // Ошибка истории — отдельный источник. Раньше она сливалась с ошибкой
  // текущего снимка, и падение только истории (её читают лишь отчёты) гасило
  // готовность всего парка и центра: снимки были на месте, а экран показывал
  // «оценка недоступна». Держим их порознь: история видна у отчётов, парк и
  // центр судят только по текущему снимку.
  const [readinessHistoryError, setReadinessHistoryError] = useState<string | null>(null);
  const [audit, setAudit] = useState<ReadinessAuditEnvelope | null>(null);
  const [auditFailed, setAuditFailed] = useState(false);
  const [readinessFilters, setReadinessFilters] = useState<ReadinessUrlFilters>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Прежнее имя параметра раздела — `tab`. Форма «Создать смену» возвращала
    // на `/admin/to?tab=shifts`, а модуль читал только `?view=` — «Назад»,
    // «Отмена» и возврат после сохранения открывали домашнюю «Готовность».
    // Читаем `tab` как синоним, чтобы старые ссылки вели в названный раздел.
    const requestedViewParam = params.get('view') ?? params.get('tab');
    viewPinnedByUrl.current = requestedViewParam !== null;
    const requestedView = parseView(requestedViewParam, surface);
    // Раздел чужого модуля в адресе — не ошибка, а старая ссылка: наряды и
    // журнал инструктажей годами открывались как `/admin/to?view=...`, и такие
    // адреса лежат в закладках, письмах и уведомлениях. Уводим туда, где
    // раздел теперь живёт, вместо молчаливой подмены на домашнюю вкладку.
    if (surfaceOfView(requestedView) !== surface) {
      // Именно `location.replace`, а не переход роутером: старый адрес не
      // должен оставаться в истории — кнопка «назад» возвращала бы на него и
      // тут же переводила обратно, зациклив шаг назад.
      window.location.replace(
        `${SURFACE_ROUTE[surfaceOfView(requestedView)]}?view=${requestedView}`,
      );
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL deep-link is the source of initial tab state
    setView(requestedView);
    setSettingsSection(parseSettingsSection(params.get('section')));
    const requestedEquipment = params.get('equipmentId');
    if (requestedEquipment) setEquipmentId(requestedEquipment);
    const nextFilters: ReadinessUrlFilters = {};
    for (const key of ['status', 'from', 'to', 'shiftType', 'risk', 'eventType', 'actor'] as const) {
      const value = params.get(key);
      if (value) (nextFilters as Record<string, string>)[key] = value;
    }
    setReadinessFilters(nextFilters);
  }, [surface]);

  /**
   * Домашний раздел модуля может быть закрыт ролью.
   *
   * Мастер читает происшествия, но чужих допусков не видит: открыв «ТБ и
   * допуски», он попадал бы на «Недостаточно прав» при том, что соседняя
   * вкладка ему открыта. Это ровно то «право есть, дороги нет», от которого
   * модуль уже лечили. Подменяем ТОЛЬКО когда раздел не назван в адресе: по
   * явной ссылке человек должен увидеть честный отказ, а не другой экран.
   */
  useEffect(() => {
    if (!bootstrap || viewPinnedByUrl.current) return;
    if (bootstrap.capabilities.screens[view] !== false) return;
    const fallback = SURFACE_TABS[surface]
      .find((tab) => bootstrap.capabilities.screens[tab.id] !== false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- permissions arrive with the bootstrap, after the initial view is chosen
    if (fallback) setView(fallback.id);
  }, [bootstrap, surface, view]);

  const loadWorkspace = useCallback(async () => {
    workspaceRequest.current?.abort();
    const controller = new AbortController();
    workspaceRequest.current = controller;
    setLoading(true);
    setBootstrapError(null);
    setWorkspaceError(null);
    setWorkspaceIssues([]);
    setOutOfRoleSources([]);
    setAuthoritativeReadinessError(null);
    setReadinessHistoryError(null);
    setDefectsError(null);
    setPermitsError(null);
    setRulesAvailable(false);
    await loadToWorkspace({
      controller,
      workspaceRequest, setLoading, setBootstrapError, setWorkspaceError,
      setWorkspaceIssues, setOutOfRoleSources, setAuthoritativeReadinessError, setReadinessHistoryError,
      setDefectsError, setPermitsError, setRulesAvailable, setBootstrap,
      readinessFilters, setShifts, setPermits, setPermitsPage,
      setDefects, setCurrentReadiness, setReadinessHistory, setAudit,
      setAuditFailed, setEquipment, setCrews, setMaintenance,
      setFleetCards, setRulesState, setEquipmentId, setDetails,
      setJournals, setJournalLoaded, setLoadAttempts,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- actingAs: смена режима «Действую как» должна пересоздать загрузчик и перезагрузить раздел (заголовок читается из хранилища при запросе)
  }, [readinessFilters, actingAs]);

  const loadMorePermits = useCallback(async () => {
    if (!permitsPage.nextCursor) return;
    const request = workspaceRequest.current;
    const page = await fetchWorkPermitsPage(undefined, readinessFilters, permitsPage.nextCursor);
    // Рабочее место успели перезагрузить: страница относится к прежнему списку.
    if (workspaceRequest.current !== request) return;
    // Курсор идёт по updatedAt: наряд, изменённый между запросами, мог попасть
    // на обе страницы — второй экземпляр отбрасываем.
    setPermits((current) => {
      const known = new Set(current.map((permit) => permit.id));
      return [...current, ...page.items.filter((permit) => !known.has(permit.id))];
    });
    setPermitsPage({ total: page.total, hasMore: page.hasMore, nextCursor: page.nextCursor });
  }, [permitsPage.nextCursor, readinessFilters]);

  useEffect(() => {
    /*
      Правило справедливо в общем случае, но здесь срабатывает вхолостую.
      loadWorkspace начинается с setLoading(true) / сброса двух ошибок — и на
      монтировании все три уже в этих значениях (loading объявлен как
      useState(true), ошибки — null), поэтому React выходит из обновления без
      перерисовки. Каскада, ради которого правило заведено, не возникает.
      Сами вызовы нужны для ПОВТОРНОЙ загрузки, где состояние уже другое.
      Убрать их значило бы сломать повтор ради тишины линтера.
    */
    // eslint-disable-next-line react-hooks/set-state-in-effect -- на монтировании сеттеры попадают в те же значения и перерисовки не вызывают; нужны для повторной загрузки
    void loadWorkspace();
    return () => workspaceRequest.current?.abort();
  }, [loadWorkspace]);

  // Догрузка журнала и карточки при выборе установки. Права те же, что и при
  // первой загрузке: без них экран снова спрашивал бы у мастера то, что ему
  // не положено, и получал 403 — а пустой журнал читался бы как «записей нет».
  //
  // Источники считаем порознь (R151 №2/№5): раньше «удалась любая половина»
  // закрывала обе, и упавшая карточка при живом журнале больше не
  // перезапрашивалась. Удачу и отказ тоже разводим: `journalLoaded` ставится
  // по полученным данным, а не по факту запроса, — иначе 500/403 на журнале
  // читался бы как «журнал пуст». Отметка «спрашивали» не даёт эффекту
  // зациклиться на отказе: новый запрос — только после действия пользователя,
  // а полная перезагрузка сбрасывает отметки.
  useEffect(() => loadSelectedToEquipment({
    actor: bootstrap?.actor, equipmentId, loadAttempts, journalLoaded,
    details, equipment, setLoadAttempts, setJournals,
    setJournalLoaded, setDetails, setWorkspaceIssues,
  }), [bootstrap?.actor, details, equipment, equipmentId, journalLoaded, loadAttempts]);

  const readinessByEquipment = useMemo(() => buildToReadinessMap({ currentReadiness, equipment, journals, journalLoaded, authoritativeReadinessError }), [authoritativeReadinessError, currentReadiness, equipment, journalLoaded, journals]);

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

  const { changeView, changeSettingsSection, changeEquipment, changeReadinessFilters } = createToNavigation({
    equipmentId, surface, setView, settingsSection,
    setSettingsSection, setEquipmentId, view, setReadinessFilters,
  });

  const referenceUiProps = {
    view, onViewChange: changeView, settingsSection,
    onSettingsSectionChange: changeSettingsSection, equipment, selectedId: equipmentId,
    onSelect: changeEquipment, readinessByEquipment, factsByEquipment,
    scoresByEquipment, rulesState, onRulesStateChange: setRulesState,
    journals, crews, maintenance,
    fleetCards, details, loading,
    workspaceError, workspaceIssues, outOfRoleSources,
    rulesAvailable, bootstrap, shifts,
    permits, permitsPage, permitsError,
    onLoadMorePermits: loadMorePermits, defects, defectsError,
    currentReadiness, authoritativeReadinessError, readinessHistoryError,
    readinessHistory, audit, auditFailed,
    filters: readinessFilters, onFiltersChange: changeReadinessFilters, showInternalNavigation: !TECH_READINESS_PRODUCTION_SHELL_ENABLED,
    onRetry: () => void loadWorkspace(),
  };
  return <ToModuleView surface={surface} bootstrapError={bootstrapError} referenceUiProps={referenceUiProps} loadWorkspace={loadWorkspace} />;
}
