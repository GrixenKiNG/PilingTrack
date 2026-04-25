/**
 * Event Contracts — Shared Types
 *
 * Все события в системе следуют единому контракту:
 * - immutable (не изменяются после создания)
 * - versioned (имеют версию схемы)
 * - self-describing (содержат метаданные для идентификации)
 *
 * Гарантии:
 * - at-least-once delivery (outbox pattern)
 * - idempotent consumers (eventId deduplication)
 * - backward compatibility (schema registry)
 */

export type UUID = string;

// ============================================================
// Event Metadata
// ============================================================

export interface EventMeta {
  eventId: UUID;          // UUID — уникальный идентификатор события
  eventType: string;      // e.g. "report.created"
  eventVersion: number;   // версия схемы события
  occurredAt: string;     // ISO timestamp — когда произошло
  tenantId: UUID;         // идентификатор тенанта
  aggregateId: UUID;      // ID агрегата (entity)
  aggregateType: string;  // тип агрегата: "report", "crew", "site"
  correlationId?: UUID;   // ID для трекинга цепочки событий
  causationId?: UUID;     // ID события-причины
  producer: string;       // имя сервиса-источника
}

// ============================================================
// Event Envelope — обёртка вокруг payload
// ============================================================

export interface EventEnvelope<T = unknown> {
  meta: EventMeta;
  payload: T;
}

// ============================================================
// Event Types — все типы событий в системе
// ============================================================

export type ReportEventType =
  | 'report.created'
  | 'report.updated'
  | 'report.submitted'
  | 'report.deleted';

export type CrewEventType =
  | 'crew.created'
  | 'crew.updated'
  | 'crew.deactivated';

export type SiteEventType =
  | 'site.created'
  | 'site.updated'
  | 'site.deleted';

export type EquipmentEventType =
  | 'equipment.created'
  | 'equipment.updated'
  | 'equipment.deleted';

export type TelemetryEventType =
  | 'telemetry.recorded';

export type SyncEventType =
  | 'sync.completed'
  | 'sync.failed'
  | 'sync.conflict_resolved';

export type SystemEventType =
  | 'system.degraded'
  | 'system.recovered';

export type DomainEventType =
  | ReportEventType
  | CrewEventType
  | SiteEventType
  | EquipmentEventType
  | TelemetryEventType
  | SyncEventType
  | SystemEventType;

// ============================================================
// Event Payloads — типизированные payload'ы
// ============================================================

export interface ReportCreatedPayload {
  id: UUID;
  userId: UUID;
  siteId: UUID;
  date: string;
  status: 'draft' | 'submitted';
  version: number;
  updatedAt: string;
  piles: { pileGradeId: string; count: number }[];
  drillings: { typeId: string; meters: number }[];
  downtimes: { reasonId: string; duration: number }[];
}

export interface ReportUpdatedPayload {
  id: UUID;
  version: number;
  updatedAt: string;
  status?: 'draft' | 'submitted';
  changes?: string[];  // список изменённых полей
}

export interface ReportSubmittedPayload {
  id: UUID;
  userId: UUID;
  submittedAt: string;
  version: number;
}

export interface ReportDeletedPayload {
  id: UUID;
  userId: UUID;
  deletedAt: string;
  version: number;
}

export interface CrewCreatedPayload {
  id: UUID;
  operatorId: UUID;
  equipmentId: UUID;
  siteId: UUID;
  name: string;
}

export interface CrewUpdatedPayload {
  id: UUID;
  changes: string[];
  updatedAt: string;
}

export interface CrewDeactivatedPayload {
  id: UUID;
  reason?: string;
  deactivatedAt: string;
}

export interface SiteCreatedPayload {
  id: UUID;
  name: string;
  tenantId: UUID;
}

export interface SiteUpdatedPayload {
  id: UUID;
  changes: string[];
  updatedAt: string;
}

export interface SiteDeletedPayload {
  id: UUID;
  deletedAt: string;
}

export interface EquipmentCreatedPayload {
  id: UUID;
  name: string;
  model: string;
  qty: number;
}

export interface EquipmentUpdatedPayload {
  id: UUID;
  changes: string[];
  updatedAt: string;
}

export interface EquipmentDeletedPayload {
  id: UUID;
  deletedAt: string;
}

export interface TelemetryRecordedPayload {
  equipmentId: UUID;
  siteId?: UUID;
  type: string;
  value: number;
  unit: string;
  timestamp: string;
}

export interface SyncCompletedPayload {
  deviceId: string;
  userId: UUID;
  changesApplied: number;
  changesPulled: number;
  conflictsResolved: number;
  syncDurationMs: number;
}

export interface SyncFailedPayload {
  deviceId: string;
  userId: UUID;
  error: string;
  attempts: number;
}

export interface SyncConflictResolvedPayload {
  deviceId: string;
  reportId: UUID;
  strategy: 'server_wins' | 'client_wins' | 'field_merge';
  resolvedAt: string;
}

export interface SystemDegradedPayload {
  component: string;
  previousStatus: string;
  currentStatus: string;
  detectedAt: string;
}

export interface SystemRecoveredPayload {
  component: string;
  previousStatus: string;
  currentStatus: string;
  recoveredAt: string;
}

// ============================================================
// Type Map — для типобезопасной диспетчеризации
// ============================================================

export interface EventPayloadMap {
  'report.created': ReportCreatedPayload;
  'report.updated': ReportUpdatedPayload;
  'report.submitted': ReportSubmittedPayload;
  'report.deleted': ReportDeletedPayload;
  'crew.created': CrewCreatedPayload;
  'crew.updated': CrewUpdatedPayload;
  'crew.deactivated': CrewDeactivatedPayload;
  'site.created': SiteCreatedPayload;
  'site.updated': SiteUpdatedPayload;
  'site.deleted': SiteDeletedPayload;
  'equipment.created': EquipmentCreatedPayload;
  'equipment.updated': EquipmentUpdatedPayload;
  'equipment.deleted': EquipmentDeletedPayload;
  'telemetry.recorded': TelemetryRecordedPayload;
  'sync.completed': SyncCompletedPayload;
  'sync.failed': SyncFailedPayload;
  'sync.conflict_resolved': SyncConflictResolvedPayload;
  'system.degraded': SystemDegradedPayload;
  'system.recovered': SystemRecoveredPayload;
}

// Type-safe envelope getter
export type TypedEnvelope<T extends DomainEventType> = EventEnvelope<EventPayloadMap[T]>;
