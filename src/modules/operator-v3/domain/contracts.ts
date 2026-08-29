export type OperatorWorkMode =
  | 'NOT_STARTED'
  | 'WORKING'
  | 'BREAK'
  | 'DOWNTIME'
  | 'MAINTENANCE'
  | 'STOP_REQUIRED'
  | 'STOPPED'
  | 'FINISHED';

export type ReadinessDecision = 'UNKNOWN' | 'ALLOWED' | 'ALLOWED_WITH_NOTES' | 'DENIED';
export type ReadinessFreshness =
  | 'COLLECTING'
  | 'CALCULATING'
  | 'CURRENT'
  | 'STALE'
  | 'RECHECK_REQUIRED'
  | 'FAILED';
export type SyncState =
  | 'SYNCED'
  | 'PENDING'
  | 'SENDING'
  | 'OFFLINE'
  | 'CONFLICT'
  | 'INTERVENTION_REQUIRED'
  | 'AUTHORIZATION_EXPIRED';

export type OperatorActionKind = 'COMMAND' | 'SCREEN' | 'NAVIGATION';
export type OfflinePolicy = 'FORBIDDEN' | 'CAPTURE_ONLY' | 'AUTHORIZED';
export type OperatorPhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type OperatorPhaseState = 'COMPLETED' | 'CURRENT' | 'UPCOMING' | 'BLOCKED';

export interface OperatorAction {
  id: string;
  label: string;
  kind: OperatorActionKind;
  offlinePolicy: OfflinePolicy;
  requiresEvidence: string[];
  confirmation: string | null;
  method?: 'POST';
  route?: string;
  expectedVersion?: number;
}

export interface OperatorPhase {
  number: OperatorPhaseNumber;
  name: string;
  state: OperatorPhaseState;
  progress: string | null;
  explanation: string | null;
}

export type OperatorDataAvailability = 'AVAILABLE' | 'NOT_PROVIDED';

export interface OperatorProfilePresentation {
  availability: OperatorDataAvailability;
  phone: string | null;
  email: string | null;
  employer: string | null;
  documents: OperatorDataAvailability;
  training: OperatorDataAvailability;
  medicalClearance: OperatorDataAvailability;
}

export interface OperatorEligibilityPresentation {
  status: 'ELIGIBLE' | 'BLOCKED';
  label: string;
  blockers: string[];
  warnings: string[];
  profile: OperatorProfilePresentation;
  knowledgeTest: {status: 'PASSED' | 'FAILED' | 'NOT_PROVIDED'; correctAnswers: number | null; totalQuestions: number | null};
}

export interface OperatorChecklistExecutionView {
  id: string;
  stage: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  answered: number;
  total: number;
  blockers: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface OperatorWeatherSnapshot {
  status: 'CURRENT' | 'UNSAFE' | 'STALE';
  observedAt: string;
  source: string;
  temperatureC: number | null;
  windSpeedMps: number | null;
  windGustMps: number | null;
  precipitation: string | null;
  visibilityMeters: number | null;
  thunderstorm: boolean | null;
  blockers: string[];
}

export interface OperatorSiteCheckView {
  status: 'CONFIRMED' | 'BLOCKED';
  occurredAt: string;
  issues: string[];
  mediaIds: string[];
  blockers: string[];
}

export interface OperatorStartupView {
  status: 'READY' | 'INCOMPLETE' | 'BLOCKED';
  startupRecorded: boolean;
  warmupRecorded: boolean;
  functionCheckCompleted: boolean;
  blockers: string[];
}

export interface OperatorMaintenanceView {
  status: 'COMPLETED' | 'INCOMPLETE' | 'BLOCKED' | 'NOT_PROVIDED';
  actions: number;
  fluidReadings: number;
  blockers: string[];
}

export interface OperatorWorkSummary {
  piles: number;
  drillingMeters: number;
  downtimeSeconds: number;
}

export interface OperatorContactPresentation {
  availability: OperatorDataAvailability;
  id: string | null;
  name: string | null;
  role: string;
  phone: string | null;
}

export interface OperatorWorkplaceSnapshot {
  revision: string;
  serverTime: string;
  operator: {
    id: string;
    name: string;
    blockers: string[];
    warnings: string[];
  };
  assignments: Array<{
    id: string;
    equipmentId: string;
    equipmentName: string;
    model: string;
    siteId: string;
    siteName: string;
  }>;
  equipment: {
    id: string;
    name: string;
    model: string;
    engineHoursTotal: number | null;
    nextMaintenanceAtHours: number | null;
    site: {id: string; name: string} | null;
  } | null;
  shift: {
    id: string;
    state: string;
    version: number;
    type: string;
    productionDate: string;
    startedAt: string | null;
  } | null;
  phase: OperatorPhase;
  phases: OperatorPhase[];
  workMode: OperatorWorkMode;
  eligibility: OperatorEligibilityPresentation;
  weather: OperatorWeatherSnapshot | null;
  checklistExecutions: OperatorChecklistExecutionView[];
  startup: OperatorStartupView | null;
  service: OperatorMaintenanceView;
  work: OperatorWorkSummary;
  readiness: {
    decision: ReadinessDecision;
    freshness: ReadinessFreshness;
    label: string;
    calculatedAt: string | null;
    ruleVersion: string | null;
    blockers: Array<{label: string; actionLabel: string}>;
    warnings: string[];
    evidence: unknown[];
  };
  actions: OperatorAction[];
  primaryAction: OperatorAction | null;
  persistentActions: OperatorAction[];
  inspections: Array<{
    id: string;
    phase: 'PRE_SHIFT' | 'POST_SHIFT';
    name: string;
    status: string;
    answered: number;
    total: number;
    items: Array<{
      id: string;
      text: string;
      answerType: 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';
      required: boolean;
      photoRequired: boolean;
      unit: string | null;
      norm: string | null;
    }>;
    answers: Array<{
      itemId: string;
      result: string;
      value: string | null;
      note: string | null;
      photoCount: number;
    }>;
  }>;
  workZone: OperatorSiteCheckView | null;
  meter: {
    knownToday: boolean;
    current: number | null;
    source: 'reading' | 'equipment' | null;
    recordedAt: string | null;
  };
  activeInterval: OperatorActiveInterval | null;
  production: {
    pilesToday: number;
    entries: OperatorProductionEntry[];
    options: {
      piles: Array<{id: string; label: string}>;
      pickets: Array<{id: string; label: string}>;
      workTypes: Array<{id: string; label: string}>;
    };
    journal: OperatorShiftJournalEntry[];
  };
  defects: Array<{
    id: string;
    severity: string;
    status: string;
    title: string;
    description: string;
    observedSigns: string[];
    evidenceMediaIds: string[];
    reportedAt: string;
  }>;
  incidents: import('./safety-incident').SafetyIncidentSummary[];
  maintenance: {
    incidentId:string; repairStatus:'NOT_STARTED'|'COMPLETED'; repairedById:string|null;
    repairedAt:string|null; repairSummary:string|null;
    independentCheck:{id:string;status:'PENDING'|'PASSED'|'FAILED';revision:number;verifiedById:string|null;verifiedAt:string|null;note:string|null}|null;
    readinessRefresh:'NOT_REQUESTED'|'PENDING'|'CURRENT'; canResume:boolean; blockers:string[];
  } | null;
  report: {id:string;status:string;summary:{piles:number;drillingMeters:number;downtimeSeconds:number};endingEngineHours:number|null;submittedAt:string|null} | null;
  handover: {
    incoming: {
      id: string;
      shiftId: string;
      summary: string;
      submittedById: string;
      submittedByName: string | null;
    } | null;
    outgoing: {id:string;shiftId:string;state:string;summary:string;submittedById:string;submittedAt:string|null;acceptedById:string|null;acceptedAt:string|null;version:number} | null;
  };
  authority: {canCloseWithoutRecipient:boolean};
  contacts: {
    dispatcher: OperatorContactPresentation;
    mechanic: OperatorContactPresentation;
    emergency: OperatorContactPresentation;
  };
  sync: {
    state: SyncState;
    pending: number;
    authorizationExpiresAt: string | null;
  };
}

export interface ResolveOperatorWorkplaceContext {
  operatorId: string;
  operatorName: string;
  serverTime?: Date;
  safetyIncidents?: import('./safety-incident').SafetyIncidentSummary[];
  activeInterval?: OperatorActiveInterval | null;
  productionEntries?: OperatorProductionEntry[];
  productionOptions?: OperatorWorkplaceSnapshot['production']['options'];
  productionJournal?: OperatorShiftJournalEntry[];
  profile?: OperatorProfilePresentation;
  knowledgeTest?: OperatorEligibilityPresentation['knowledgeTest'];
  checklistExecutions?: OperatorChecklistExecutionView[];
  weather?: OperatorWeatherSnapshot | null;
  workZone?: OperatorSiteCheckView | null;
  startup?: OperatorStartupView | null;
  service?: OperatorMaintenanceView;
  workSummary?: OperatorWorkSummary;
  contacts?: OperatorWorkplaceSnapshot['contacts'];
}

export interface OperatorActiveInterval {
  id: string;
  kind: 'BREAK' | 'DOWNTIME';
  status: 'OPEN';
  startedAt: string;
  reason: string | null;
  category: 'TECHNICAL' | 'ORGANIZATIONAL' | 'WEATHER' | 'SAFETY' | 'OTHER' | null;
  comment: string | null;
  durationSeconds: null;
  version: number;
}

export interface OperatorProductionEntry {
  id: string; clientCommandId: string; pileId: string; pileLabel: string;
  picketId: string | null; picketLabel: string | null; workTypeId: string;
  workTypeLabel: string; depth: number; startedAt: string; endedAt: string;
  result: string; comment: string | null; correctionReason: string | null;
  occurredAt: string; state: 'CONFIRMED';
}

export interface OperatorShiftJournalEntry {
  id: string; occurredAt: string; title: string; details: string | null;
  state: 'CONFIRMED' | 'PENDING' | 'CONFLICT';
}

export interface OperatorChecklistAnswer {
  itemId: string;
  result: string;
  value: number | string | null;
  note: string | null;
  mediaIds: string[];
  answeredAt: string;
}

export type OperatorBlockerSource =
  | 'CHECKLIST'
  | 'DEFECT'
  | 'DOCUMENT'
  | 'TRAINING'
  | 'MAINTENANCE'
  | 'SITE'
  | 'WEATHER';

export type OperatorBlockerSeverity = 'INFO' | 'NORMAL' | 'IMPORTANT' | 'CRITICAL';

export interface OperatorBlocker {
  id: string;
  source: OperatorBlockerSource;
  itemId: string | null;
  reason: string;
  severity: OperatorBlockerSeverity;
  createdAt: string;
  resolution: string | null;
  blocking: boolean;
  ruleCode: string | null;
}
