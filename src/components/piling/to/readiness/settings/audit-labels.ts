/**
 * Русские подписи для доказательного журнала.
 *
 * Коды действий (`shift.acceptance-declined`) и типов сущностей (`ShiftHandover`)
 * — внутренние; в журнале их читает диспетчер, а не разработчик. Неизвестный
 * код показываем как есть, чтобы новое действие не исчезло из журнала молча.
 */
const ACTION_LABEL: Record<string, string> = {
  'shift.created': 'Смена запланирована',
  'shift.acceptance-requested': 'Запрошен допуск к работе',
  'shift.acceptance-declined': 'В допуске отказано',
  'shift.started': 'Смена допущена к работе',
  'shift.start-blocked': 'Запуск смены заблокирован',
  'shift.cancelled': 'Смена отменена',
  'handover.submitted': 'Смена передана диспетчеру',
  'handover.accepted': 'Передача принята',
  'handover.rework-requested': 'Передача возвращена на доработку',
  'work-permit.created': 'Наряд-допуск создан',
  'work-permit.updated': 'Наряд-допуск изменён',
  'work-permit.submit': 'Наряд отправлен на согласование',
  'work-permit.approve': 'Наряд согласован',
  'work-permit.revoke': 'Наряд отозван',
  'defect.reported': 'Зафиксировано замечание',
  'defect.triage': 'Замечание разобрано',
  'defect.resolve': 'Замечание закрыто',
  'defect.reject': 'Замечание отклонено',
  'readiness.exported': 'Выгрузка данных готовности',
  published: 'Опубликованы правила готовности',
  acting_as_mechanic: 'Включён режим «действую за механика»',
};

const ENTITY_LABEL: Record<string, string> = {
  Shift: 'Смена',
  ShiftHandover: 'Передача смены',
  WorkPermit: 'Наряд-допуск',
  EquipmentDefect: 'Замечание',
  Equipment: 'Установка',
  Inspection: 'Осмотр',
  MaintenanceRecord: 'Обслуживание',
  ReadinessRuleSet: 'Правила готовности',
  ReadinessExport: 'Выгрузка',
};

/**
 * Действия, которые меняют допуск техники к работе или сами правила допуска.
 * Их отдельно считает плитка «Критических действий».
 */
const CRITICAL_ACTIONS = new Set([
  'shift.start-blocked',
  'shift.acceptance-declined',
  'handover.rework-requested',
  'work-permit.revoke',
  'defect.reported',
  'published',
  'acting_as_mechanic',
]);

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function auditEntityLabel(type: string): string {
  return ENTITY_LABEL[type] ?? (type || 'Контур');
}

export function isCriticalAuditAction(action: string): boolean {
  return CRITICAL_ACTIONS.has(action);
}
