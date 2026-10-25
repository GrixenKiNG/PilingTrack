'use client';

import { type WorkspaceIssue, readOptionalCollectionWithIssue, readOptionalJsonWithIssue, readAuthoritativeCollection, EMPTY_PERMITS_PAGE, readReadinessPartial } from './to-module-data';

import { TECH_READINESS_PRODUCTION_SHELL_ENABLED, type ModuleSurface, OUTCOME_STATUS, STAGE_EVIDENCE_KEY, STAGE_EVIDENCE_STATE, DEFECTS_UNAVAILABLE_MESSAGE, PERMITS_UNAVAILABLE_MESSAGE, SURFACE_TABS, SURFACE_ROUTE, SURFACE_LABEL, SURFACE_HOME, surfaceOfView, parseView, parseSettingsSection } from './to-module-config';
export { TECH_READINESS_PRODUCTION_SHELL_ENABLED } from './to-module-config';
export type { ModuleSurface } from './to-module-config';

import { usePilingStore } from '@/lib/store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDocumentTitle } from '@/components/piling/ops-shell';
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
import type { ActingRole } from '@/lib/types';
import { TechReadinessModule } from './readiness/tech-readiness-module';
import { InspectionLayer } from './inspection-layer';
import type { QueryState } from './readiness/boundaries/query-state';
import {
  fetchCurrentReadiness,
  fetchReadinessAudit,
  fetchReadinessBootstrap,
  fetchReadinessHistory,
  fetchReadinessShifts,
  fetchWorkPermitsPage,
  fetchReadinessDefects,
  type WorkPermitsPage,
  type ReadinessUrlFilters,
} from './readiness/api/client';
import type {
  CurrentReadinessDto,
  ReadinessAuditEnvelope,
  ReadinessBootstrap,
  ReadinessShiftDto,
  ReadinessSnapshotDto,
  WorkPermitDto,
  DefectDto,
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
import { deriveEquipmentReadiness, type EquipmentReadiness, type ReadinessEvidence } from './readiness-model';
import {
  buildAuthoritativeReadinessPresentation,
  buildUnavailableReadinessPresentation,
} from './readiness/authoritative-presentation';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
// Та же матрица прав, по которой откажет сервер. Модуль чистый — ни базы,
// ни серверных зависимостей, — поэтому безопасен в клиентской сборке.
import { can } from '@/services/auth/authorization-service';
import { resolveEffectiveRole } from '@/lib/types';

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
    try {
      // Роль замещения уходит заголовком `x-acting-as` из `authFetch`, сервер
      // берёт её из сессии — повторный запрос с ролью не нужен.
      const readinessBootstrap = await fetchReadinessBootstrap({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setBootstrap(readinessBootstrap);
      // Спрашиваем только то, что роли положено. Раньше здесь стоял один
      // признак «не оператор», и мастер, которому наряды ТО не положены по
      // матрице готовности, всё равно запрашивал обслуживание, журнал и
      // карточку установки — получал три 403 на ровном месте, а экран выдавал
      // этот отказ за отсутствие данных о технике. Матрица здесь та же, по
      // которой откажет сервер, поэтому спрашивать «а вдруг пустят» не нужно.
      const actor = readinessBootstrap.actor;
      const canReadCrews = can(actor, 'crews.read');
      const canReadMaintenance = can(actor, 'maintenance.manage');
      const canReadEquipmentCard = can(actor, 'equipment.read');
      // Данные по всему парку: рабочее место машиниста их не показывает и
      // берёт свою установку из самого контура. Это выбор экрана, не запрет.
      // По ИСПОЛНЯЕМОЙ роли, как и права рядом: администратор в режиме
      // «Действую как машинист» должен видеть экран машиниста — иначе режим
      // показывает не то, что увидит человек, ради которого его включили.
      const usesParkWideData = resolveEffectiveRole(actor.role, actor.actingAs) !== 'OPERATOR';
      setOutOfRoleSources(usesParkWideData ? [
        ...(canReadCrews ? [] : ['Бригады']),
        ...(canReadMaintenance ? [] : ['Обслуживание и журнал ТО']),
        ...(canReadEquipmentCard ? [] : ['Карточка установки']),
      ] : []);
      const [
        equipmentResponse,
        crewResult,
        maintenanceResult,
        fleetResult,
        readinessRulesResult,
        shiftsResult,
        permitsResult,
        defectsResult,
        currentResult,
        historyResult,
        auditResult,
      ] = await Promise.all([
        usesParkWideData ? authFetch('/api/equipment?limit=100') : Promise.resolve(null),
        usesParkWideData && canReadCrews ? readOptionalCollectionWithIssue<CrewSummary>(
          '/api/crews?limit=100',
          'data',
          'Бригады',
        ) : Promise.resolve({ data: [] as CrewSummary[], issue: null }),
        usesParkWideData && canReadMaintenance ? readOptionalCollectionWithIssue<MaintenanceSummary>(
          '/api/maintenance',
          'records',
          'Обслуживание',
        ) : Promise.resolve({ data: [] as MaintenanceSummary[], issue: null }),
        usesParkWideData ? readOptionalJsonWithIssue<FleetSnapshot>(
          '/api/monitoring/fleet',
          'Мониторинг парка',
        ) : Promise.resolve({ data: null, issue: null }),
        readOptionalJsonWithIssue<ReadinessRulesState>(
          '/api/readiness-rules',
          'Правила готовности',
        ),
        readReadinessPartial(fetchReadinessShifts(controller.signal, readinessFilters), []),
        readReadinessPartial(fetchWorkPermitsPage(controller.signal, readinessFilters), EMPTY_PERMITS_PAGE),
        readReadinessPartial(fetchReadinessDefects(controller.signal, readinessFilters), []),
        readAuthoritativeCollection(fetchCurrentReadiness(controller.signal, readinessFilters)),
        readAuthoritativeCollection(fetchReadinessHistory(controller.signal, readinessFilters)),
        readinessBootstrap.capabilities.entities.audit.read
          ? readReadinessPartial(fetchReadinessAudit(controller.signal, readinessFilters), null)
          : Promise.resolve({ data: null, failed: false }),
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
      setShifts(shiftsResult.data);
      setPermits(permitsResult.data.items);
      setPermitsError(permitsResult.failed ? PERMITS_UNAVAILABLE_MESSAGE : null);
      setPermitsPage({ total: permitsResult.data.total, hasMore: permitsResult.data.hasMore, nextCursor: permitsResult.data.nextCursor });
      setDefects(defectsResult.data);
      setDefectsError(defectsResult.failed ? DEFECTS_UNAVAILABLE_MESSAGE : null);
      setCurrentReadiness(currentResult.data);
      setReadinessHistory(historyResult.data);
      setAuthoritativeReadinessError(currentResult.error);
      setReadinessHistoryError(historyResult.error);
      setAudit(auditResult.data);
      setAuditFailed(auditResult.failed);
      // Дефекты выведены из общего ИЛИ (F-N1005-DEFECTS-UNKNOWN): у отказа
      // журнала замечаний теперь свой источник с именем, а его состояние
      // (defectsError) экраны показывают прочерком, а не нулём.
      const readinessPartialFailure =
        shiftsResult.failed || permitsResult.failed || auditResult.failed;
      const initialIssues = [
        crewResult.issue,
        maintenanceResult.issue,
        fleetResult.issue,
        readinessRulesResult.issue,
        ...(defectsResult.failed ? [{
          source: 'Дефекты',
          message: DEFECTS_UNAVAILABLE_MESSAGE,
        } satisfies WorkspaceIssue] : []),
        ...(readinessPartialFailure ? [{
          source: 'Техготовность',
          message: 'Не удалось загрузить часть данных техготовности. Обновите страницу.',
        } satisfies WorkspaceIssue] : []),
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
        usesParkWideData && canReadMaintenance
          ? readOptionalJsonWithIssue<{ records?: JournalRecord[] }>(
              `/api/to/journal?equipmentId=${encodeURIComponent(primaryEquipment.id)}`,
              `Журнал «${primaryEquipment.name}»`,
            )
          : Promise.resolve({ data: null, issue: null }),
        usesParkWideData && canReadEquipmentCard
          ? readOptionalJsonWithIssue<EquipmentDetailSnapshot>(
              `/api/equipment/${encodeURIComponent(primaryEquipment.id)}/details`,
              `Карточка «${primaryEquipment.name}»`,
            )
          : Promise.resolve({ data: null, issue: null }),
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
      // Первичный путь уже спросил (или осознанно не стал спрашивать) оба
      // источника выбранной установки — отмечаем, чтобы эффект догрузки не
      // повторил упавший запрос и не задвоил сообщение об ошибке.
      setLoadAttempts({ [primaryEquipment.id]: { journal: true, card: true } });
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
  useEffect(() => {
    const actor = bootstrap?.actor;
    if (!equipmentId || !actor) return;
    if (resolveEffectiveRole(actor.role, actor.actingAs) === 'OPERATOR') return;
    const mayReadJournal = can(actor, 'maintenance.manage');
    const mayReadCard = can(actor, 'equipment.read');
    const attempted = loadAttempts[equipmentId] ?? { journal: false, card: false };
    const needJournal = mayReadJournal && journalLoaded[equipmentId] !== true && !attempted.journal;
    const needCard = mayReadCard && details[equipmentId] === undefined && !attempted.card;
    if (!needJournal && !needCard) return;
    const name = equipment.find((item) => item.id === equipmentId)?.name ?? equipmentId;
    let active = true;
    void Promise.all([
      needJournal
        ? readOptionalJsonWithIssue<{ records?: JournalRecord[] }>(
            `/api/to/journal?equipmentId=${encodeURIComponent(equipmentId)}`,
            `Журнал «${name}»`,
          )
        : Promise.resolve({ data: null, issue: null }),
      needCard
        ? readOptionalJsonWithIssue<EquipmentDetailSnapshot>(
            `/api/equipment/${encodeURIComponent(equipmentId)}/details`,
            `Карточка «${name}»`,
          )
        : Promise.resolve({ data: null, issue: null }),
    ]).then(([journal, detail]) => {
      if (!active) return;
      setLoadAttempts((previous) => ({
        ...previous,
        [equipmentId]: { journal: true, card: true },
      }));
      if (needJournal) {
        setJournals((previous) => ({ ...previous, [equipmentId]: journal.data?.records ?? [] }));
        setJournalLoaded((previous) => ({ ...previous, [equipmentId]: journal.data != null }));
      }
      const nextDetail = detail.data;
      if (needCard && nextDetail) {
        setDetails((previous) => ({ ...previous, [equipmentId]: nextDetail }));
      }
      const issues = [journal.issue, detail.issue]
        .filter((issue): issue is WorkspaceIssue => issue !== null);
      if (issues.length > 0) setWorkspaceIssues((previous) => [...previous, ...issues]);
    });
    return () => { active = false; };
  }, [bootstrap?.actor, details, equipment, equipmentId, journalLoaded, loadAttempts]);

  const readinessByEquipment = useMemo(() => {
    // Карточка парка собирается из авторитетного снимка целиком.
    //
    // ЧТО БЫЛО НЕ ТАК. Балл и вердикт брались из снимка, а причина, следующее
    // действие и доказательства — из производной оценки по журналу. Журнал
    // грузится только для выбранной установки, поэтому у остальных эти поля
    // просто затирались пустыми строками. Получалась карточка, где зелёная
    // цифра с сервера соседствует с объяснением из другого расчёта или без
    // объяснения вовсе, — и проверить её было не по чему.
    //
    // Вдобавок вердикт схлопывался в «готово»: снимок хранит `status` из двух
    // значений (READY/BLOCKED), а различие «готова», «готова с замечанием» и
    // «требует решения» живёт в `outcome`. Читая `status`, экран красил
    // зелёным и то, что требует решения диспетчера.
    //
    // Производная оценка остаётся ровно для одного случая — снимка нет вовсе.
    // Тогда честный ответ «не подтверждено», а не выдуманная готовность.
    const authoritative = new Map(currentReadiness.map((item) => [item.equipmentId, item]));
    const entries = equipment.map((item) => {
      const snapshot = authoritative.get(item.id);
      const derived = deriveEquipmentReadiness(
        item,
        journals[item.id] ?? [],
        journalLoaded[item.id] === true,
      );

      // Отказ авторитетного чтения не заменяем производной оценкой: журнал
      // может быть полон и дать зелёный READY, хотя сервер вердикта не вынес
      // (R151 №4). Как в парке и центре, показываем «не подтверждено».
      const presentation = authoritativeReadinessError
        ? buildUnavailableReadinessPresentation(snapshot ?? null)
        : snapshot
          ? buildAuthoritativeReadinessPresentation(snapshot)
          : null;
      if (!presentation) return [item.id, derived] as const;

      if (presentation.status === 'UNCONFIRMED') {
        return [item.id, {
          ...derived,
          status: 'NO_DATA',
          canOperate: false,
          score: presentation.score,
          reason: presentation.description,
          nextAction: presentation.nextAction,
          nextActionHref: '',
          evidence: [],
        } satisfies EquipmentReadiness] as const;
      }

      return [item.id, {
        ...derived,
        score: presentation.score,
        status: OUTCOME_STATUS[presentation.outcome] ?? 'READY',
        canOperate: presentation.outcome === 'READY' || presentation.outcome === 'READY_WITH_WARNING',
        reason: presentation.description,
        nextAction: presentation.nextAction,
        nextActionHref: '',
        evidence: presentation.stages.map((stage): ReadinessEvidence => ({
          key: STAGE_EVIDENCE_KEY[stage.key],
          label: stage.label,
          value: stage.value,
          state: STAGE_EVIDENCE_STATE[stage.state],
        })),
      } satisfies EquipmentReadiness] as const;
    });
    return Object.fromEntries(entries) as Record<string, EquipmentReadiness>;
  }, [authoritativeReadinessError, currentReadiness, equipment, journalLoaded, journals]);

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
    if (nextView === SURFACE_HOME[surface]) url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    if (nextView === 'settings') url.searchParams.set('section', nextSection);
    else url.searchParams.delete('section');
    if (nextEquipmentId) url.searchParams.set('equipmentId', nextEquipmentId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const changeView = (next: ReferenceView) => {
    // Раздел чужого модуля (например, «Происшествия» из обзора «ТБ и допусков»,
    // переехавшие в «Техготовность») открывается его адресом: в чужой оболочке
    // не подсветилась бы ни одна вкладка.
    if (surfaceOfView(next) !== surface) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- полная загрузка нужна: оболочка другого модуля монтируется заново (как у старых ссылок выше)
      window.location.assign(`${SURFACE_ROUTE[surfaceOfView(next)]}?view=${next}`);
      return;
    }
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
      outOfRoleSources={outOfRoleSources}
      rulesAvailable={rulesAvailable}
      bootstrap={bootstrap}
      shifts={shifts}
      permits={permits}
      permitsPage={permitsPage}
      permitsError={permitsError}
      onLoadMorePermits={loadMorePermits}
      defects={defects}
      defectsError={defectsError}
      currentReadiness={currentReadiness}
      authoritativeReadinessError={authoritativeReadinessError}
      readinessHistoryError={readinessHistoryError}
      readinessHistory={readinessHistory}
      audit={audit}
      auditFailed={auditFailed}
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
