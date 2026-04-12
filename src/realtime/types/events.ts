/**
 * Realtime Event Types
 *
 * Unified type system for all real-time events flowing through
 * WebSocket, Redis Pub/Sub, and event bus.
 */

// ============================================================
// Base Event
// ============================================================

export interface RealtimeEventBase {
  id: string;
  type: string;
  tenantId: string | null;
  siteId: string | null;
  userId: string | null;
  ts: number;
}

// ============================================================
// Report Events
// ============================================================

export interface ReportUpdatedEvent extends RealtimeEventBase {
  type: 'report.updated';
  entity: 'report';
  entityId: string;
  payload: {
    reportId: string;
    totalPiles: number;
    totalDrilling: number;
    totalDowntime: number;
    status: string;
    updatedAt: string;
  };
}

export interface ReportCreatedEvent extends RealtimeEventBase {
  type: 'report.created';
  entity: 'report';
  entityId: string;
  payload: {
    reportId: string;
    siteId: string;
    date: string;
    shiftType: string;
  };
}

export interface ReportSubmittedEvent extends RealtimeEventBase {
  type: 'report.submitted';
  entity: 'report';
  entityId: string;
  payload: {
    reportId: string;
    siteId: string;
    totalPiles: number;
    totalDrilling: number;
    totalDowntime: number;
  };
}

// ============================================================
// Downtime Events
// ============================================================

export interface DowntimeAddedEvent extends RealtimeEventBase {
  type: 'downtime.added';
  entity: 'report';
  entityId: string;
  payload: {
    reasonId: string;
    reasonName?: string;
    duration: number;
    reportId: string;
  };
}

// ============================================================
// Alert Events
// ============================================================

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertCreatedEvent extends RealtimeEventBase {
  type: 'alert.created';
  entity: 'system';
  entityId: string;
  payload: {
    severity: AlertSeverity;
    ruleId: string;
    message: string;
    siteId?: string;
    reportId?: string;
    sourceEvent?: string;
  };
}

export interface AlertResolvedEvent extends RealtimeEventBase {
  type: 'alert.resolved';
  entity: 'system';
  entityId: string;
  payload: {
    alertId: string;
    ruleId: string;
    resolvedAt: string;
  };
}

// ============================================================
// Telemetry Events (future IIoT)
// ============================================================

export interface TelemetryReceivedEvent extends RealtimeEventBase {
  type: 'telemetry.received';
  entity: 'telemetry';
  entityId: string;
  payload: {
    equipmentId: string;
    type: string;
    value: number;
    unit?: string;
  };
}

// ============================================================
// System Events
// ============================================================

export interface SystemHealthEvent extends RealtimeEventBase {
  type: 'system.health';
  entity: 'system';
  entityId: 'global';
  payload: {
    component: string;
    status: 'ok' | 'degraded' | 'error';
    message?: string;
  };
}

// ============================================================
// Union Type
// ============================================================

export type RealtimeEvent =
  | ReportUpdatedEvent
  | ReportCreatedEvent
  | ReportSubmittedEvent
  | DowntimeAddedEvent
  | AlertCreatedEvent
  | AlertResolvedEvent
  | TelemetryReceivedEvent
  | SystemHealthEvent;

// ============================================================
// Channel Types
// ============================================================

export type ChannelType =
  | `tenant:${string}`
  | `site:${string}`
  | `report:${string}`
  | `operator:${string}`
  | `alert:${string}`
  | `system:${string}`
  | `telemetry:${string}`;

// ============================================================
// WebSocket Message Protocol
// ============================================================

export type WSClientMessage =
  | { type: 'subscribe'; channel: ChannelType }
  | { type: 'unsubscribe'; channel: ChannelType }
  | { type: 'ping' }
  | { type: 'pong' };

export type WSServerMessage =
  | RealtimeEvent
  | { type: 'pong'; serverTs: number }
  | { type: 'error'; message: string; code: string };

// ============================================================
// Helpers
// ============================================================

export function toChannel(event: RealtimeEvent): ChannelType[] {
  const channels: ChannelType[] = [];

  if (event.tenantId) channels.push(`tenant:${event.tenantId}`);
  if (event.siteId) channels.push(`site:${event.siteId}`);
  channels.push(`${event.entity}:${event.entityId}`);
  if (event.userId) channels.push(`operator:${event.userId}`);

  return channels;
}

export function createEvent<E extends RealtimeEvent>(
  type: E['type'],
  entity: E['entity'],
  entityId: string,
  payload: E['payload'],
  options?: {
    tenantId?: string | null;
    siteId?: string | null;
    userId?: string | null;
  }
): E {
  return {
    id: crypto.randomUUID(),
    type,
    entity,
    entityId,
    payload,
    tenantId: options?.tenantId || null,
    siteId: options?.siteId || null,
    userId: options?.userId || null,
    ts: Date.now(),
  } as E;
}
