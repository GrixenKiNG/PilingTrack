import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from './maintenance-labels';

export interface MaintenanceFilter {
  status?: MaintenanceStatus | '';
  priority?: MaintenancePriority | '';
  assigneeId?: string;
  type?: MaintenanceType | '';
}

export function buildMaintenanceQuery(filter: MaintenanceFilter): string {
  const sp = new URLSearchParams();
  if (filter.status) sp.set('status', filter.status);
  if (filter.priority) sp.set('priority', filter.priority);
  if (filter.assigneeId) sp.set('assigneeId', filter.assigneeId);
  if (filter.type) sp.set('type', filter.type);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function resolveAssigneeName(id: string | null, names: Map<string, string>): string {
  if (!id) return '—';
  return names.get(id) ?? '—';
}

const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'DONE', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function nextStatusActions(status: MaintenanceStatus): MaintenanceStatus[] {
  return TRANSITIONS[status] ?? [];
}

/**
 * Текст отказа по HTTP-статусу для экранов ТО.
 *
 * Компоненты клали в тост серверный `err.error` как есть: на истёкшую сессию
 * механик читал английское «Unauthorized», а отказ по правам (403) ничем не
 * отличался от сбоя сервера. 401/403/404 и 5xx объясняются по-русски, остальное
 * (400/409 и т.п.) остаётся серверным сообщением — оно по делу.
 */
export function maintenanceErrorText(status: number, serverError?: unknown): string {
  if (status === 401) return 'Сессия истекла — войдите снова.';
  if (status === 403) return 'Нет прав на обслуживание. Смените роль или обратитесь к администратору.';
  if (status === 404) return 'Наряд не найден (возможно, удалён).';
  if (status >= 500) return 'Сервер временно недоступен — повторите позже.';
  const text = typeof serverError === 'string' ? serverError.trim() : '';
  return text || 'Не удалось выполнить действие.';
}

/**
 * Текст тоста из пойманного исключения: обрыв сети (`fetch` бросает `TypeError`
 * с английским «Failed to fetch») объясняется по-русски, остальное берётся из
 * сообщения ошибки.
 */
export function maintenanceCatchText(cause: unknown, fallback: string): string {
  if (cause instanceof TypeError) return 'Нет связи с сервером — повторите при появлении сети.';
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
