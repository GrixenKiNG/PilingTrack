import type {OperatorShiftFacts} from '@/modules/readiness/application/operator-shift-query';
import {OPERATOR_PHASE_NAMES, READINESS_LABELS} from '../application/russian-labels';
import {
  persistentOperatorActionsForVersion,
  resolvePrimaryAction,
  safeStopAction,
} from './action-policy';
import type {
  OperatorPhase,
  OperatorPhaseNumber,
  OperatorWorkMode,
  OperatorWorkplaceSnapshot,
  ReadinessDecision,
  ReadinessFreshness,
  ResolveOperatorWorkplaceContext,
} from './contracts';

interface ResolvedPhase {
  number: OperatorPhaseNumber;
  progress: string | null;
  explanation: string | null;
  blocked: boolean;
}

function inspectionProgress(inspection: {answered: number; total: number} | null): string | null {
  if (!inspection || inspection.total <= 0) return null;
  return `${inspection.answered} из ${inspection.total} пунктов`;
}

function resolvePhase(facts: OperatorShiftFacts, context: ResolveOperatorWorkplaceContext): ResolvedPhase {
  const shiftStarted = facts.shift?.state === 'STARTED' || facts.shift?.state === 'HANDOVER_PENDING';

  if (facts.clearance.blockers.length > 0 && !shiftStarted) {
    return {
      number: 1,
      progress: null,
      explanation: facts.clearance.blockers.join('. '),
      blocked: true,
    };
  }

  if (facts.assignments.length === 0) {
    return {
      number: 1,
      progress: null,
      explanation: 'Нет доступного назначения. Обратитесь к ответственному сотруднику',
      blocked: true,
    };
  }

  if (!facts.shift) {
    return {
      number: 2,
      progress: facts.assignments.length === 1
        ? facts.assignments[0].equipmentName
        : `Доступно назначений: ${facts.assignments.length}`,
      explanation: 'Выберите и примите установку',
      blocked: false,
    };
  }

  if (facts.shift.state === 'HANDOVER_PENDING') {
    return {
      number: 8,
      progress: 'Передача отправлена',
      explanation: 'Ожидается принятие установки',
      blocked: false,
    };
  }

  if (facts.incomingHandover && facts.incomingHandover.shiftId !== facts.shift.id) {
    return {
      number: 2,
      progress: facts.incomingHandover.summary,
      explanation: 'Проверьте сведения предыдущей смены',
      blocked: facts.incomingHandover.submittedById.length === 0,
    };
  }

  if (facts.shift.state === 'STARTED') {
    if (facts.report?.status === 'submitted') {
      return {
        number: 8,
        progress: 'Отчёт отправлен',
        explanation: 'Передайте установку следующей смене',
        blocked: false,
      };
    }
    if (facts.inspection.postShift || facts.report) {
      return {
        number: 7,
        progress: inspectionProgress(facts.inspection.postShift),
        explanation: 'Завершите обязательные действия смены',
        blocked: false,
      };
    }
    return {
      number: 6,
      progress: facts.pilesToday > 0 ? `Выполнено свай: ${facts.pilesToday}` : null,
      explanation: 'Фиксируйте выполненную работу и события смены',
      blocked: false,
    };
  }

  if (facts.shift.state === 'COMPLETED' || facts.shift.state === 'CLOSED') {
    return {number: 8, progress: 'Смена закрыта', explanation: null, blocked: false};
  }

  const preShift = facts.inspection.preShift;
  const checklist = context.checklistExecutions?.find((execution) => execution.stage === 'PRE_SHIFT') ?? null;
  const checklistBlockers = checklist?.blockers ?? [];
  const checklistCompleted = checklist?.status === 'COMPLETED' || preShift?.status === 'COMPLETED';
  if (!checklistCompleted) {
    return {
      number: 3,
      progress: checklist ? `${checklist.answered} из ${checklist.total} пунктов` : inspectionProgress(preShift),
      explanation: checklistBlockers.length > 0
        ? checklistBlockers.join('. ')
        : preShift || checklist ? 'Продолжите проверку установки' : 'Выполните предсменный осмотр',
      blocked: checklist?.status === 'BLOCKED' || checklistBlockers.length > 0,
    };
  }

  if (!facts.meterKnownToday) {
    return {
      number: 3,
      progress: 'Проверка завершена',
      explanation: 'Зафиксируйте текущее показание моточасов',
      blocked: false,
    };
  }

  const siteBlockers = context.workZone?.blockers ?? [];
  const weatherBlockers = context.weather?.blockers ?? [];
  const siteBlocked = context.workZone?.status === 'BLOCKED' || siteBlockers.length > 0;
  const weatherBlocked = context.weather?.status === 'UNSAFE' || weatherBlockers.length > 0;
  if (!context.workZone || !context.weather || siteBlocked || weatherBlocked) {
    const blockers = [...siteBlockers, ...weatherBlockers];
    return {
      number: 4,
      progress: context.workZone && context.weather ? 'Данные площадки и погоды получены' : null,
      explanation: blockers.length > 0
        ? blockers.join('. ')
        : !context.weather ? 'Зафиксируйте погоду' : 'Подтвердите безопасность площадки',
      blocked: siteBlocked || weatherBlocked,
    };
  }

  const readinessBlocked = facts.readiness?.verdict === 'DENIED'
    || facts.readiness?.status === 'BLOCKED'
    || (facts.readiness?.blockers.length ?? 0) > 0;

  const startupBlockers = context.startup?.blockers ?? [];
  const serviceBlockers = context.service?.blockers ?? [];
  const startupBlocked = context.startup?.status === 'BLOCKED' || startupBlockers.length > 0;
  const serviceBlocked = context.service?.status === 'BLOCKED' || serviceBlockers.length > 0;
  const startupReady = context.startup?.status === 'READY';
  const serviceReady = context.service?.status === 'COMPLETED';
  const blockers = [...startupBlockers, ...serviceBlockers];
  return {
    number: 5,
    progress: startupReady && serviceReady ? 'Пусковые проверки завершены' : null,
    explanation: blockers.length > 0
      ? blockers.join('. ')
      : readinessBlocked
        ? 'Устраните препятствия перед пуском'
        : startupReady && serviceReady
          ? 'Все обязательные данные собраны'
          : 'Завершите запуск, прогрев и обслуживание',
    blocked: (startupBlocked || serviceBlocked || readinessBlocked) && facts.startWaiver === null,
  };
}

function readinessDecision(facts: OperatorShiftFacts): ReadinessDecision {
  if (!facts.readiness) return 'UNKNOWN';
  if (facts.readiness.verdict === 'DENIED' || facts.readiness.status === 'BLOCKED') return 'DENIED';
  if (facts.readiness.verdict === 'ALLOWED_WITH_NOTES') return 'ALLOWED_WITH_NOTES';
  if (facts.readiness.verdict === 'ALLOWED') return 'ALLOWED';
  return 'UNKNOWN';
}

function readinessFreshness(facts: OperatorShiftFacts): ReadinessFreshness {
  if (!facts.readiness) return 'COLLECTING';
  if (facts.readiness.status === 'FAILED') return 'FAILED';
  if (facts.readiness.status === 'CALCULATING') return 'CALCULATING';
  return 'CURRENT';
}

function workMode(facts: OperatorShiftFacts): OperatorWorkMode {
  if (!facts.shift) return 'NOT_STARTED';
  if (facts.shift.state === 'STARTED') return 'WORKING';
  if (facts.shift.state === 'HANDOVER_PENDING') return 'FINISHED';
  if (facts.shift.state === 'COMPLETED' || facts.shift.state === 'CLOSED') return 'FINISHED';
  return 'NOT_STARTED';
}

function snapshotRevision(
  facts: OperatorShiftFacts,
  operatorId: string,
  safetyIncidents: ResolveOperatorWorkplaceContext['safetyIncidents'],
  activeInterval: ResolveOperatorWorkplaceContext['activeInterval'],
  productionEntries: ResolveOperatorWorkplaceContext['productionEntries'],
): string {
  const source = JSON.stringify({
    operatorId,
    assignments: facts.assignments,
    equipmentId: facts.equipment?.id ?? null,
    shift: facts.shift,
    readiness: facts.readiness
      ? {
          verdict: facts.readiness.verdict,
          status: facts.readiness.status,
          blockers: facts.readiness.blockers,
        }
      : null,
    inspection: facts.inspection,
    report: facts.report,
    meterKnownToday: facts.meterKnownToday,
    meterCurrent: facts.meterCurrent,
    pilesToday: facts.pilesToday,
    incomingHandover: facts.incomingHandover,
    clearance: facts.clearance,
    safetyIncidents,
    activeInterval,
    productionEntries,
  });

  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v3-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function phaseList(current: ResolvedPhase): OperatorPhase[] {
  const result: OperatorPhase[] = [];
  for (let number = 1 as OperatorPhaseNumber; number <= 8; number += 1) {
    const state = number < current.number
      ? 'COMPLETED'
      : number > current.number
        ? 'UPCOMING'
        : current.blocked
          ? 'BLOCKED'
          : 'CURRENT';
    result.push({
      number,
      name: OPERATOR_PHASE_NAMES[number],
      state,
      progress: number === current.number ? current.progress : null,
      explanation: number === current.number ? current.explanation : null,
    });
  }
  return result;
}

export function resolveOperatorWorkplace(
  facts: OperatorShiftFacts,
  context: ResolveOperatorWorkplaceContext,
): OperatorWorkplaceSnapshot {
  const currentPhase = resolvePhase(facts, context);
  const decision = readinessDecision(facts);
  const phases = phaseList(currentPhase);
  const incidents = context.safetyIncidents ?? [];
  const stopRequired = incidents.find((incident) => incident.state === 'STOP_REQUIRED') ?? null;
  const stopped = stopRequired
    ? null
    : incidents.find((incident) => incident.state === 'STOPPED' && incident.stopRequired) ?? null;
  const expectedVersion = facts.shift?.version ?? 0;
  const persistentActions = persistentOperatorActionsForVersion(expectedVersion);
  const activeInterval = context.activeInterval ?? null;
  const normalPrimaryAction = activeInterval && currentPhase.number === 5
    ? {
        id: 'finish-interval', label: activeInterval.kind === 'BREAK' ? 'Завершить перерыв' : 'Завершить простой',
        kind: 'COMMAND' as const, method: 'POST' as const,
        route: '/api/operator/v3/commands/finish-interval', expectedVersion,
        offlinePolicy: 'FORBIDDEN' as const, requiresEvidence: [], confirmation: null,
      }
    : resolvePrimaryAction(currentPhase.number, facts, decision, context);
  const primaryAction = stopRequired
    ? safeStopAction(stopRequired.id, expectedVersion)
    : stopped
      ? null
      : normalPrimaryAction;
  const selectedAssignment = facts.equipment
    ? facts.assignments.find((assignment) => assignment.equipmentId === facts.equipment?.id) ?? null
    : null;

  const inspections: OperatorWorkplaceSnapshot['inspections'] = [];
  if (facts.inspection.preShift) {
    inspections.push({
      ...facts.inspection.preShift,
      phase: 'PRE_SHIFT',
      name: 'Проверка до работы',
      items: [],
      answers: [],
    });
  }
  if (facts.inspection.postShift) {
    inspections.push({
      ...facts.inspection.postShift,
      phase: 'POST_SHIFT',
      name: 'Проверка после работы',
      items: [],
      answers: [],
    });
  }

  return {
    revision: snapshotRevision(facts, context.operatorId, incidents, activeInterval, context.productionEntries ?? []),
    serverTime: (context.serverTime ?? new Date()).toISOString(),
    operator: {
      id: context.operatorId,
      name: context.operatorName,
      blockers: [...facts.clearance.blockers],
      warnings: [...facts.clearance.warnings],
    },
    assignments: facts.assignments.map((assignment) => ({
      id: `${assignment.siteId}:${assignment.equipmentId}`,
      ...assignment,
    })),
    equipment: facts.equipment
      ? {
          ...facts.equipment,
          site: selectedAssignment
            ? {id: selectedAssignment.siteId, name: selectedAssignment.siteName}
            : null,
        }
      : null,
    shift: facts.shift ? {...facts.shift} : null,
    phase: phases[currentPhase.number - 1],
    phases,
    workMode: stopRequired ? 'STOP_REQUIRED' : stopped ? 'STOPPED' : activeInterval?.kind ?? workMode(facts),
    readiness: {
      decision,
      freshness: readinessFreshness(facts),
      label: READINESS_LABELS[decision],
      calculatedAt: null,
      ruleVersion: null,
      blockers: facts.readiness?.blockers.map((blocker) => ({...blocker})) ?? [],
      warnings: [...facts.clearance.warnings],
      evidence: [],
    },
    actions: primaryAction
      ? [primaryAction,
          ...(!stopRequired && !stopped && !activeInterval && currentPhase.number === 6 ? [
            {id:'start-break',label:'Начать перерыв',kind:'COMMAND' as const,method:'POST' as const,route:'/api/operator/v3/commands/start-break',expectedVersion,offlinePolicy:'FORBIDDEN' as const,requiresEvidence:[],confirmation:null},
            {id:'start-downtime',label:'Начать простой',kind:'COMMAND' as const,method:'POST' as const,route:'/api/operator/v3/commands/start-downtime',expectedVersion,offlinePolicy:'FORBIDDEN' as const,requiresEvidence:[],confirmation:null},
          ] : []), ...persistentActions]
      : [...persistentActions],
    primaryAction,
    persistentActions,
    inspections,
    workZone: null,
    meter: {
      knownToday: facts.meterKnownToday,
      current: facts.meterCurrent,
      source: facts.meterSource,
      recordedAt: facts.meterRecordedAt,
    },
    activeInterval,
    production: {
      pilesToday: facts.pilesToday,
      entries: context.productionEntries ?? [],
      options: context.productionOptions ?? {piles: [], pickets: [], workTypes: []},
      journal: context.productionJournal ?? [],
    },
    defects: [],
    incidents: incidents.map((incident) => ({
      ...incident,
      title: incident.category === 'EQUIPMENT_DEFECT'
        ? 'Критический дефект'
        : 'Опасное событие',
      instruction: incident.state === 'STOP_REQUIRED'
        ? 'Немедленно прекратите производственные действия и переведите установку в безопасное состояние'
        : incident.state === 'STOPPED'
          ? 'Не возобновляйте работу до устранения причины и новой оценки готовности'
          : 'Событие зарегистрировано. Следуйте указанию ответственного сотрудника',
      requiresSafeStop: incident.stopRequired,
      safeStopApplied: incident.state === 'STOPPED',
    })),
    maintenance: null,
    report: facts.report ? {id:facts.report.id,status:facts.report.status,summary:{piles:facts.pilesToday,drillingMeters:0,downtimeSeconds:0},endingEngineHours:null,submittedAt:null} : null,
    handover: {
      incoming: facts.incomingHandover ? {...facts.incomingHandover} : null,
      outgoing: null,
    },
    authority: {canCloseWithoutRecipient:false},
    contacts: {dispatcher: null, mechanic: null, emergency: null},
    sync: {
      state: 'SYNCED',
      pending: 0,
      authorizationExpiresAt: null,
    },
  };
}
