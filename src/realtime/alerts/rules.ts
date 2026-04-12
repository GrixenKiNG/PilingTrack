/**
 * Alert Rules — DSL for Defining Alert Conditions
 *
 * Declarative rule definition for the alert engine.
 * Each rule specifies: condition, severity, message template, notify channels.
 */

import { RealtimeEvent } from '../types/events';
import type { AlertSeverity } from '../types/events';

// ============================================================
// Payload Types
// ============================================================

export interface DowntimePayload {
  duration: number;
  reasonId?: string;
  comment?: string;
}

export interface ReportPayload {
  totalPiles: number;
  totalDrilling: number;
  date?: string;
  shiftType?: string;
}

// Type-safe payload accessor
function getDowntimePayload(event: RealtimeEvent): DowntimePayload {
  const p = event.payload as Record<string, unknown>;
  return {
    duration: typeof p.duration === 'number' ? p.duration : 0,
    reasonId: typeof p.reasonId === 'string' ? p.reasonId : undefined,
    comment: typeof p.comment === 'string' ? p.comment : undefined,
  };
}

function getReportPayload(event: RealtimeEvent): ReportPayload {
  const p = event.payload as Record<string, unknown>;
  return {
    totalPiles: typeof p.totalPiles === 'number' ? p.totalPiles : 0,
    totalDrilling: typeof p.totalDrilling === 'number' ? p.totalDrilling : 0,
    date: typeof p.date === 'string' ? p.date : undefined,
    shiftType: typeof p.shiftType === 'string' ? p.shiftType : undefined,
  };
}

// ============================================================
// Rule Definition
// ============================================================

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: (event: RealtimeEvent, ctx: AlertContext) => boolean;
  message: (event: RealtimeEvent, ctx: AlertContext) => string;
  cooldownMs: number; // Minimum time between alerts for this rule
  notify: ('websocket' | 'telegram' | 'email')[];
}

export interface AlertContext {
  tenantId: string | null;
  siteId: string | null;
  userId: string | null;
  // Enriched data (filled by engine)
  siteName?: string;
  userName?: string;
  reportId?: string;
}

// ============================================================
// Built-in Rules
// ============================================================

export const builtInRules: AlertRule[] = [
  // 1. High downtime (> 2 hours in a single entry)
  {
    id: 'high-downtime',
    name: 'Длительный простой',
    description: 'Простой более 2 часов за одну запись',
    severity: 'high',
    condition: (event) =>
      event.type === 'downtime.added' &&
      getDowntimePayload(event).duration > 120,
    message: (event) => {
      const p = getDowntimePayload(event);
      return `Простой ${p.duration}мин на объекте. Причина: ${p.reasonId || 'не указана'}`;
    },
    cooldownMs: 30 * 60 * 1000, // 30 min cooldown
    notify: ['websocket', 'telegram'],
  },

  // 2. Critical downtime (> 4 hours)
  {
    id: 'critical-downtime',
    name: 'Критический простой',
    description: 'Простой более 4 часов',
    severity: 'critical',
    condition: (event) =>
      event.type === 'downtime.added' &&
      getDowntimePayload(event).duration > 240,
    message: (event) => {
      const p = getDowntimePayload(event);
      return `КРИТИЧЕСКИЙ простой ${p.duration}мин! Объект требует немедленного внимания.`;
    },
    cooldownMs: 60 * 60 * 1000, // 1 hour cooldown
    notify: ['websocket', 'telegram'],
  },

  // 3. Report submitted with zero production
  {
    id: 'zero-production-report',
    name: 'Отчёт без производства',
    description: 'Отчёт отправлен, но нет свай и бурения',
    severity: 'medium',
    condition: (event) => {
      const p = getReportPayload(event);
      return (
        event.type === 'report.submitted' &&
        p.totalPiles === 0 &&
        p.totalDrilling === 0
      );
    },
    message: (event) => {
      const p = getReportPayload(event);
      return `Отчёт за ${p.date || 'смену'} без производства. Объект: ${event.siteId}`;
    },
    cooldownMs: 2 * 60 * 60 * 1000, // 2 hours
    notify: ['websocket'],
  },

  // 4. Multiple downtimes in one report (> 3 entries)
  {
    id: 'frequent-downtimes',
    name: 'Частые простои',
    description: 'Более 3 простоев в одном отчёте',
    severity: 'medium',
    condition: (event, ctx) => false, // Requires aggregate check — skip for now
    message: () => '',
    cooldownMs: 60 * 60 * 1000,
    notify: ['websocket'],
  },
];

// ============================================================
// Custom Rules (user-defined via UI later)
// ============================================================

const customRules = new Map<string, AlertRule>();

export function addCustomRule(rule: AlertRule): void {
  customRules.set(rule.id, rule);
}

export function removeCustomRule(ruleId: string): void {
  customRules.delete(ruleId);
}

export function getAllRules(): AlertRule[] {
  return [...builtInRules, ...customRules.values()];
}
