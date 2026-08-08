export const READINESS_ABILITIES = [
  'readiness.read',
  'readiness.shift.manage',
  'readiness.handover.prepare',
  'readiness.handover.decide',
  'readiness.inspection.manage',
  // Список обязан совпадать с READINESS_ABILITIES на сервере: клиент
  // отвергает весь ответ, если встретит незнакомое право, и модуль
  // не загружается целиком.
  'readiness.defect.report',
  'readiness.defect.manage',
  'readiness.meter.manage',
  'readiness.maintenance.manage',
  'readiness.permit.edit',
  'readiness.permit.approve_dispatcher',
  'readiness.permit.approve_admin',
  'readiness.rules.manage',
  'readiness.audit.read',
  'readiness.audit.export',
] as const;

export type ReadinessAbility = (typeof READINESS_ABILITIES)[number];

export interface ReadinessBootstrap {
  tenant: { timezone: string };
  actor: {
    id: string;
    role: string;
    actingAs: 'MECHANIC' | null;
  };
  featureFlags: {
    readiness_shifts_v1: boolean;
    readiness_permits_v1: boolean;
    readiness_audit_chain_v1: boolean;
  };
  selectors: {
    equipment: Array<{ id: string; name: string; model: string | null }>;
    sites: Array<{ id: string; name: string }>;
    actors: Array<{ id: string; name: string; role: string }>;
  };
  counts: {
    equipment: number;
    sites: number;
    activeCrews: number;
    publishedRuleSets: number;
    draftRuleSets: number;
  };
  capabilities: {
    abilities: ReadinessAbility[];
    screens: {
      readiness: boolean;
      fleet: boolean;
      shifts: boolean;
      permits: boolean;
      maintenance: boolean;
      reports: boolean;
      settings: boolean;
    };
    entities: {
      equipment: { read: boolean };
      inspection: { manage: boolean };
      defect: { manage: boolean };
      meter: { manage: boolean };
      maintenance: { manage: boolean };
      shift: {
        manage: boolean;
        prepareHandover: boolean;
        decideHandover: boolean;
      };
      permit: {
        edit: boolean;
        approveDispatcher: boolean;
        approveAdmin: boolean;
      };
      rules: { manage: boolean };
      audit: { read: boolean; export: boolean };
    };
    canActAsMechanic: boolean;
  };
}

export interface ReadinessBootstrapEnvelope {
  data: ReadinessBootstrap;
  meta: { requestId: string };
}

export interface ReadinessHandoverDto {
  id: string;
  shiftId: string;
  state: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REWORK_REQUESTED';
  summary: string | null;
  version: number;
  submittedAt: string | null;
  acceptedAt: string | null;
}

export interface ReadinessShiftDto {
  id: string;
  equipmentId: string;
  type: 'DAY' | 'NIGHT';
  state: 'PLANNED' | 'STARTED' | 'HANDOVER_PENDING' | 'CLOSED' | 'CANCELLED';
  productionDate: string;
  timezone: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  version: number;
  handovers: ReadinessHandoverDto[];
}

export interface WorkPermitDto {
  id: string;
  equipmentId: string;
  shiftId: string | null;
  risk: 'NORMAL' | 'ELEVATED';
  state: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
  scope: string;
  validFrom: string;
  validTo: string;
  timezone: string;
  version: number;
  approvals: Array<{ id: string; role: 'DISPATCHER' | 'ADMIN'; decision: string; decidedAt: string }>;
}

export const authoritativeReadinessFactsSchema = z.object({
  inspectionCompleted: z.boolean(),
  inspectionProgress: z.number().min(0).max(1),
  healthScore: z.number().min(0).max(100).nullable(),
  meterKnown: z.boolean(),
  permitValid: z.boolean().nullable(),
  permitExpired: z.boolean(),
  maintenanceConfigured: z.boolean(),
  maintenanceOverdueHours: z.number().min(0),
  maintenanceOverdueDays: z.number().min(0),
  accepted: z.boolean(),
  criticalDefect: z.boolean(),
  findings: z.number().int().min(0),
}).strict();

const authoritativeSnapshotBaseSchema = z.object({
  equipmentId: z.string().min(1),
  status: z.enum(['READY', 'BLOCKED']),
  score: z.number().int().min(0).max(100),
  calculatedAt: z.iso.datetime(),
  blockers: z.unknown(),
  warnings: z.unknown(),
  evidence: z.unknown(),
  facts: authoritativeReadinessFactsSchema.nullable(),
  triggerType: z.string().min(1).nullable(),
  ruleSetVersion: z.string().min(1).nullable(),
}).strict();

export const currentReadinessDtoSchema = authoritativeSnapshotBaseSchema.extend({
  snapshotId: z.string().min(1),
}).strict();

export const readinessSnapshotDtoSchema = authoritativeSnapshotBaseSchema.extend({
  id: z.string().min(1),
  shiftId: z.string().min(1).nullable(),
  triggerId: z.string().min(1),
  factsHash: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

const currentReadinessResponseSchema = z.object({
  data: z.array(currentReadinessDtoSchema),
}).strict();

const readinessHistoryResponseSchema = z.object({
  data: z.array(readinessSnapshotDtoSchema),
  page: z.object({limit: z.number().int().min(1), total: z.number().int().min(0)}).strict(),
  filters: z.record(z.string(), z.string()),
}).strict();

export type AuthoritativeReadinessFactsDto = z.infer<typeof authoritativeReadinessFactsSchema>;
export type CurrentReadinessDto = z.infer<typeof currentReadinessDtoSchema>;
export type ReadinessSnapshotDto = z.infer<typeof readinessSnapshotDtoSchema>;

export function parseCurrentReadinessResponse(value: unknown): CurrentReadinessDto[] {
  return currentReadinessResponseSchema.parse(value).data;
}

export function parseReadinessHistoryResponse(value: unknown): ReadinessSnapshotDto[] {
  return readinessHistoryResponseSchema.parse(value).data;
}

export interface ReadinessAuditEventDto {
  id: string;
  sequence: string;
  occurredAt: string;
  actor: { id: string | null; name: string | null; role: string | null; actingAs: string | null };
  action: string;
  entity: { type: string; id: string; version: number | null };
  correlationId: string;
  hash: string;
  prevHash: string | null;
}

export interface ReadinessAuditEnvelope {
  data: ReadinessAuditEventDto[];
  verification: {
    valid: boolean;
    eventCount: number;
    lastSequence: string;
    headHash: string | null;
    reason?: string;
  };
}

const abilitySet = new Set<string>(READINESS_ABILITIES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function booleanRecord(value: unknown, keys: readonly string[]): boolean {
  return record(value) && keys.every((key) => typeof value[key] === 'boolean');
}

function selector(value: unknown, withModel = false): boolean {
  return record(value)
    && stringValue(value.id)
    && stringValue(value.name)
    && (!withModel || value.model === null || typeof value.model === 'string');
}

function actorSelector(value: unknown): boolean {
  return selector(value) && record(value) && stringValue(value.role);
}

export function isReadinessBootstrapEnvelope(
  value: unknown,
): value is ReadinessBootstrapEnvelope {
  if (!record(value) || !record(value.meta) || !stringValue(value.meta.requestId)) return false;
  const data = value.data;
  if (!record(data)) return false;
  if (!record(data.tenant) || !stringValue(data.tenant.timezone)) return false;
  if (
    !record(data.actor)
    || !stringValue(data.actor.id)
    || !stringValue(data.actor.role)
    || (data.actor.actingAs !== null && data.actor.actingAs !== 'MECHANIC')
  ) return false;
  if (!booleanRecord(data.featureFlags, [
    'readiness_shifts_v1',
    'readiness_permits_v1',
    'readiness_audit_chain_v1',
  ])) return false;

  const selectors = data.selectors;
  if (
    !record(selectors)
    || !Array.isArray(selectors.equipment)
    || !selectors.equipment.every((item) => selector(item, true))
    || !Array.isArray(selectors.sites)
    || !selectors.sites.every((item) => selector(item))
    || !Array.isArray(selectors.actors)
    || !selectors.actors.every((item) => actorSelector(item))
  ) return false;

  const counts = data.counts;
  if (
    !record(counts)
    || !['equipment', 'sites', 'activeCrews', 'publishedRuleSets', 'draftRuleSets']
      .every((key) => Number.isInteger(counts[key]) && (counts[key] as number) >= 0)
  ) return false;

  const capabilities = data.capabilities;
  if (!record(capabilities) || !Array.isArray(capabilities.abilities)) return false;
  if (!capabilities.abilities.every((ability) => stringValue(ability) && abilitySet.has(ability))) {
    return false;
  }
  if (!booleanRecord(capabilities.screens, [
    'readiness', 'fleet', 'shifts', 'permits', 'maintenance', 'reports', 'settings',
  ])) return false;
  if (typeof capabilities.canActAsMechanic !== 'boolean' || !record(capabilities.entities)) {
    return false;
  }

  const entities = capabilities.entities;
  return booleanRecord(entities.equipment, ['read'])
    && booleanRecord(entities.inspection, ['manage'])
    && booleanRecord(entities.defect, ['manage'])
    && booleanRecord(entities.meter, ['manage'])
    && booleanRecord(entities.maintenance, ['manage'])
    && booleanRecord(entities.shift, ['manage', 'prepareHandover', 'decideHandover'])
    && booleanRecord(entities.permit, ['edit', 'approveDispatcher', 'approveAdmin'])
    && booleanRecord(entities.rules, ['manage'])
    && booleanRecord(entities.audit, ['read', 'export']);
}
import { z } from 'zod';
