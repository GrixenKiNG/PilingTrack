import type { Dispatch, SetStateAction, RefObject } from 'react';
import { type WorkspaceIssue, readOptionalCollectionWithIssue, readOptionalJsonWithIssue, readAuthoritativeCollection, EMPTY_PERMITS_PAGE, readReadinessPartial } from './to-module-data';
import { DEFECTS_UNAVAILABLE_MESSAGE, PERMITS_UNAVAILABLE_MESSAGE } from './to-module-config';
import { toast } from 'sonner';
import type { FleetCard, FleetSnapshot } from '@/components/piling/admin-equipment/fleet-types';
import { authFetch } from '@/lib/api';
import { type ReadinessRulesState } from '@/modules/readiness';
import type { CrewSummary, MaintenanceSummary } from './readiness-design-views';
import { fetchCurrentReadiness, fetchReadinessAudit, fetchReadinessBootstrap, fetchReadinessHistory, fetchReadinessShifts, fetchWorkPermitsPage, fetchReadinessDefects, type WorkPermitsPage, type ReadinessUrlFilters } from './readiness/api/client';
import type { ReadinessAuditEnvelope, ReadinessBootstrap, ReadinessShiftDto, WorkPermitDto, DefectDto } from './readiness/api/contracts';
import { ReadinessApiError, isReadinessRequestCancelled } from './readiness/api/errors';
import { type EquipmentDetailSnapshot } from './readiness-reference-ui';
import type { EquipmentOption } from './to-module-bits';
import type { JournalRecord } from './to-stats';
import { can } from '@/services/auth/authorization-service';
import { resolveEffectiveRole } from '@/lib/types';

interface WorkspaceLoadBindings {
  controller: AbortController;
  workspaceRequest: RefObject<AbortController | null>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setBootstrapError: Dispatch<SetStateAction<ReadinessApiError | null>>;
  setWorkspaceError: Dispatch<SetStateAction<string | null>>;
  setWorkspaceIssues: Dispatch<SetStateAction<WorkspaceIssue[]>>;
  setOutOfRoleSources: Dispatch<SetStateAction<string[]>>;
  setAuthoritativeReadinessError: Dispatch<SetStateAction<string | null>>;
  setReadinessHistoryError: Dispatch<SetStateAction<string | null>>;
  setDefectsError: Dispatch<SetStateAction<string | null>>;
  setPermitsError: Dispatch<SetStateAction<string | null>>;
  setRulesAvailable: Dispatch<SetStateAction<boolean>>;
  setBootstrap: Dispatch<SetStateAction<ReadinessBootstrap | null>>;
  readinessFilters: ReadinessUrlFilters;
  setShifts: Dispatch<SetStateAction<ReadinessShiftDto[]>>;
  setPermits: Dispatch<SetStateAction<WorkPermitDto[]>>;
  setPermitsPage: Dispatch<SetStateAction<Pick<WorkPermitsPage, "total" | "hasMore" | "nextCursor">>>;
  setDefects: Dispatch<SetStateAction<DefectDto[]>>;
  setCurrentReadiness: Dispatch<SetStateAction<{ equipmentId: string; status: "READY" | "BLOCKED"; score: number; calculatedAt: string; blockers: { [x: string]: unknown; label: string; action: string; condition?: string | undefined; code?: string | undefined; actionLabel?: string | undefined; }[]; warnings: unknown; evidence: unknown; facts: { inspectionCompleted: boolean; inspectionProgress: number; healthScore: number | null; meterKnown: boolean; permitValid: boolean | null; permitExpired: boolean; maintenanceConfigured: boolean; maintenanceOverdueHours: number; maintenanceOverdueDays: number; accepted: boolean; criticalDefect: boolean; findings: number; permitCloseReason?: "WORK_DONE" | "VALIDITY_ELAPSED" | null | undefined; } | null; triggerType: string | null; ruleSetVersion: string | null; snapshotId: string; verdict?: "ALLOWED" | "CONFIRMATION_REQUIRED" | "RETURN_TO_OPERATOR" | "DENIED" | null | undefined; equipmentActive?: boolean | undefined; }[]>>;
  setReadinessHistory: Dispatch<SetStateAction<{ equipmentId: string; status: "READY" | "BLOCKED"; score: number; calculatedAt: string; blockers: { [x: string]: unknown; label: string; action: string; condition?: string | undefined; code?: string | undefined; actionLabel?: string | undefined; }[]; warnings: unknown; evidence: unknown; facts: { inspectionCompleted: boolean; inspectionProgress: number; healthScore: number | null; meterKnown: boolean; permitValid: boolean | null; permitExpired: boolean; maintenanceConfigured: boolean; maintenanceOverdueHours: number; maintenanceOverdueDays: number; accepted: boolean; criticalDefect: boolean; findings: number; permitCloseReason?: "WORK_DONE" | "VALIDITY_ELAPSED" | null | undefined; } | null; triggerType: string | null; ruleSetVersion: string | null; id: string; shiftId: string | null; triggerId: string; factsHash: string; verdict?: "ALLOWED" | "CONFIRMATION_REQUIRED" | "RETURN_TO_OPERATOR" | "DENIED" | null | undefined; }[]>>;
  setAudit: Dispatch<SetStateAction<ReadinessAuditEnvelope | null>>;
  setAuditFailed: Dispatch<SetStateAction<boolean>>;
  setEquipment: Dispatch<SetStateAction<EquipmentOption[]>>;
  setCrews: Dispatch<SetStateAction<CrewSummary[]>>;
  setMaintenance: Dispatch<SetStateAction<MaintenanceSummary[]>>;
  setFleetCards: Dispatch<SetStateAction<FleetCard[]>>;
  setRulesState: Dispatch<SetStateAction<ReadinessRulesState>>;
  setEquipmentId: Dispatch<SetStateAction<string>>;
  setDetails: Dispatch<SetStateAction<Record<string, EquipmentDetailSnapshot>>>;
  setJournals: Dispatch<SetStateAction<Record<string, JournalRecord[]>>>;
  setJournalLoaded: Dispatch<SetStateAction<Record<string, boolean>>>;
  setLoadAttempts: Dispatch<SetStateAction<Record<string, { journal: boolean; card: boolean; }>>>;
}

export async function loadToWorkspace({
  controller, workspaceRequest, setLoading, setBootstrapError,
  setWorkspaceError, setWorkspaceIssues, setOutOfRoleSources, setAuthoritativeReadinessError,
  setReadinessHistoryError, setDefectsError, setPermitsError, setRulesAvailable,
  setBootstrap, readinessFilters, setShifts, setPermits,
  setPermitsPage, setDefects, setCurrentReadiness, setReadinessHistory,
  setAudit, setAuditFailed, setEquipment, setCrews,
  setMaintenance, setFleetCards, setRulesState, setEquipmentId,
  setDetails, setJournals, setJournalLoaded, setLoadAttempts,
}: WorkspaceLoadBindings) {
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
  }
