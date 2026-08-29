import {z} from 'zod';

const nullableText = z.string().nullable();
const phaseNumber = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]);

export const operatorActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['COMMAND', 'SCREEN', 'NAVIGATION']),
  offlinePolicy: z.enum(['FORBIDDEN', 'CAPTURE_ONLY', 'AUTHORIZED']),
  requiresEvidence: z.array(z.string()),
  confirmation: nullableText,
  method: z.literal('POST').optional(),
  route: z.string().startsWith('/api/operator/v3/').optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const operatorPhaseSchema = z.object({
  number: phaseNumber,
  name: z.string().min(1),
  state: z.enum(['COMPLETED', 'CURRENT', 'UPCOMING', 'BLOCKED']),
  progress: nullableText,
  explanation: nullableText,
}).strict();

const observedHazardSignSchema = z.enum([
  'LEAK', 'PRESSURE_LOSS', 'PROTECTIVE_SYSTEM_FAILURE', 'SMOKE', 'ODOR',
  'UNUSUAL_NOISE', 'UNCONTROLLED_MOVEMENT', 'EMERGENCY_STOP', 'OTHER',
]);

const defectSummarySchema = z.object({
  id: z.string().min(1), severity: z.string().min(1), status: z.string().min(1),
  title: z.string().min(1), description: z.string().min(1),
  observedSigns: z.array(observedHazardSignSchema), evidenceMediaIds: z.array(z.string().min(1)),
  reportedAt: z.iso.datetime(),
}).strict();

const safetyIncidentSummarySchema = z.object({
  id: z.string().min(1), state: z.enum(['REPORTED', 'STOP_REQUIRED', 'STOPPED']),
  category: z.string().min(1), severity: z.enum(['NORMAL', 'HIGH', 'CRITICAL']),
  description: z.string().min(1), observedSigns: z.array(observedHazardSignSchema).min(1),
  stopRequired: z.boolean(), evidenceMediaIds: z.array(z.string().min(1)),
  occurredAt: z.iso.datetime(), stoppedAt: nullableText,
  title: z.string().min(1), instruction: z.string().min(1),
  requiresSafeStop: z.boolean(), safeStopApplied: z.boolean(),
}).strict();

const productionOptionSchema = z.object({id: z.string().min(1), label: z.string().min(1)}).strict();
const workIntervalSchema = z.object({
  id: z.string().min(1), kind: z.enum(['BREAK', 'DOWNTIME']), status: z.literal('OPEN'),
  startedAt: z.iso.datetime(), reason: nullableText,
  category: z.enum(['TECHNICAL', 'ORGANIZATIONAL', 'WEATHER', 'SAFETY', 'OTHER']).nullable(),
  comment: nullableText, durationSeconds: z.number().int().nonnegative().nullable(),
  version: z.number().int().nonnegative(),
}).strict();
const productionEntrySchema = z.object({
  id: z.string().min(1), clientCommandId: z.string().min(1), pileId: z.string().min(1),
  pileLabel: z.string().min(1), picketId: nullableText, picketLabel: nullableText,
  workTypeId: z.string().min(1), workTypeLabel: z.string().min(1), depth: z.number().nonnegative(),
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), result: z.string().min(1),
  comment: nullableText, correctionReason: nullableText, occurredAt: z.iso.datetime(),
  state: z.literal('CONFIRMED'),
}).strict();
const shiftJournalEntrySchema = z.object({
  id: z.string().min(1), occurredAt: z.iso.datetime(), title: z.string().min(1),
  details: nullableText, state: z.enum(['CONFIRMED', 'PENDING', 'CONFLICT']),
}).strict();
const maintenanceSchema = z.object({
  incidentId: z.string().min(1), repairStatus: z.enum(['NOT_STARTED', 'COMPLETED']),
  repairedById: nullableText, repairedAt: nullableText, repairSummary: nullableText,
  independentCheck: z.object({
    id: z.string().min(1), status: z.enum(['PENDING', 'PASSED', 'FAILED']),
    revision: z.number().int().positive(), verifiedById: nullableText,
    verifiedAt: nullableText, note: nullableText,
  }).strict().nullable(),
  readinessRefresh: z.enum(['NOT_REQUESTED', 'PENDING', 'CURRENT']),
  canResume: z.boolean(), blockers: z.array(z.string()),
}).strict();
const reportSchema = z.object({
  id: z.string().min(1), status: z.enum(['draft', 'submitted']),
  summary: z.object({piles: z.number().int().nonnegative(), drillingMeters: z.number().nonnegative(), downtimeSeconds: z.number().int().nonnegative()}).strict(),
  endingEngineHours: z.number().nonnegative().nullable(), submittedAt: nullableText,
}).strict();
const outgoingHandoverSchema = z.object({
  id: z.string().min(1), shiftId: z.string().min(1), state: z.enum(['SUBMITTED', 'REWORK_REQUIRED', 'ACCEPTED']),
  summary: z.string(), submittedById: z.string().min(1), submittedAt: z.iso.datetime(),
  acceptedById: nullableText, acceptedAt: nullableText, version: z.number().int().nonnegative(),
}).strict();

export const operatorWorkplaceWireSchema = z.object({
  revision: z.string().min(1),
  serverTime: z.iso.datetime(),
  operator: z.object({
    id: z.string().min(1), name: z.string().min(1),
    blockers: z.array(z.string()), warnings: z.array(z.string()),
  }).strict(),
  assignments: z.array(z.object({
    id: z.string().min(1), equipmentId: z.string().min(1), equipmentName: z.string().min(1),
    model: z.string(), siteId: z.string().min(1), siteName: z.string().min(1),
  }).strict()),
  equipment: z.object({
    id: z.string().min(1), name: z.string().min(1), model: z.string(),
    engineHoursTotal: z.number().nullable(), nextMaintenanceAtHours: z.number().nullable(),
    site: z.object({id: z.string().min(1), name: z.string().min(1)}).strict().nullable(),
  }).strict().nullable(),
  shift: z.object({
    id: z.string().min(1), state: z.string().min(1), version: z.number().int().nonnegative(),
    type: z.string().min(1), productionDate: z.string().min(1), startedAt: nullableText,
  }).strict().nullable(),
  phase: operatorPhaseSchema,
  phases: z.array(operatorPhaseSchema).length(7),
  workMode: z.enum(['NOT_STARTED', 'WORKING', 'BREAK', 'DOWNTIME', 'MAINTENANCE', 'STOP_REQUIRED', 'STOPPED', 'FINISHED']),
  readiness: z.object({
    decision: z.enum(['UNKNOWN', 'ALLOWED', 'ALLOWED_WITH_NOTES', 'DENIED']),
    freshness: z.enum(['COLLECTING', 'CALCULATING', 'CURRENT', 'STALE', 'RECHECK_REQUIRED', 'FAILED']),
    label: z.string().min(1), calculatedAt: nullableText, ruleVersion: nullableText,
    blockers: z.array(z.object({label: z.string().min(1), actionLabel: z.string().min(1)}).strict()),
    warnings: z.array(z.string()), evidence: z.array(z.unknown()),
  }).strict(),
  actions: z.array(operatorActionSchema),
  primaryAction: operatorActionSchema.nullable(),
  persistentActions: z.array(operatorActionSchema),
  inspections: z.array(z.object({
    id: z.string().min(1), phase: z.enum(['PRE_SHIFT', 'POST_SHIFT']), name: z.string().min(1),
    status: z.string().min(1), answered: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
    items: z.array(z.object({
      id: z.string().min(1), text: z.string().min(1),
      answerType: z.enum(['YES_NO', 'STATUS4', 'DONE', 'MEASURE']),
      required: z.boolean(), photoRequired: z.boolean(), unit: nullableText, norm: nullableText,
    }).strict()),
    answers: z.array(z.object({
      itemId: z.string().min(1), result: z.string(), value: nullableText,
      note: nullableText, photoCount: z.number().int().nonnegative(),
    }).strict()),
  }).strict()),
  workZone: z.unknown().nullable(),
  meter: z.object({
    knownToday: z.boolean(), current: z.number().nullable(),
    source: z.enum(['reading', 'equipment']).nullable(), recordedAt: nullableText,
  }).strict(),
  activeInterval: workIntervalSchema.nullable(),
  production: z.object({
    pilesToday: z.number().int().nonnegative(), entries: z.array(productionEntrySchema),
    options: z.object({
      piles: z.array(productionOptionSchema), pickets: z.array(productionOptionSchema),
      workTypes: z.array(productionOptionSchema),
    }).strict(),
    journal: z.array(shiftJournalEntrySchema),
  }).strict(),
  defects: z.array(defectSummarySchema), incidents: z.array(safetyIncidentSummarySchema),
  maintenance: maintenanceSchema.nullable(),
  report: reportSchema.nullable(),
  handover: z.object({
    incoming: z.object({
      id: z.string().min(1), shiftId: z.string().min(1), summary: z.string(),
      submittedById: z.string(), submittedByName: nullableText,
      // Версия записи обязательна: приёмка передачи — критическая команда, и
      // без версии контур отвечает 428. Поле появилось в общих фактах смены,
      // а строгая схема его не знала — рабочее место падало у любого
      // оператора, которому предыдущая смена оставила передачу.
      version: z.number().int().nonnegative(),
    }).strict().nullable(),
    outgoing: outgoingHandoverSchema.nullable(),
  }).strict(),
  authority: z.object({canCloseWithoutRecipient: z.boolean()}).strict(),
  contacts: z.object({dispatcher: z.unknown().nullable(), mechanic: z.unknown().nullable(), emergency: z.unknown().nullable()}).strict(),
  sync: z.object({
    state: z.enum(['SYNCED', 'PENDING', 'SENDING', 'OFFLINE', 'CONFLICT', 'INTERVENTION_REQUIRED', 'AUTHORIZATION_EXPIRED']),
    pending: z.number().int().nonnegative(), authorizationExpiresAt: nullableText,
  }).strict(),
}).strict();

export type OperatorWorkplaceWire = z.infer<typeof operatorWorkplaceWireSchema>;
