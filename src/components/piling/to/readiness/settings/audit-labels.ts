/**
 * Русские подписи для доказательного журнала.
 *
 * Коды действий (`shift.acceptance-declined`) и типов сущностей (`ShiftHandover`)
 * — внутренние; в журнале их читает диспетчер, а не разработчик. Неизвестный
 * код показываем как есть, чтобы новое действие не исчезло из журнала молча.
 */
import type { LucideIcon } from 'lucide-react';
// Намеренно напрямую из lucide, а не через `unified-icons`: там часть имён
// (`Send`, `FileText`) подменяется растровыми значками PilingTrack. В плотной
// ленте журнала это давало разнобой — цветной PNG рядом с контурными знаками,
// — и, главное, растр не принимает цвет тона: событие 'передано' теряло бы
// синий, а 'отозвано' красный.
import {
  AlertTriangle, Ban, CalendarPlus, CheckCircle2, Download, FileText, KeyRound,
  Lock, Pencil, PlayCircle, Search, Send, ShieldAlert, Upload, UserCog, XCircle,
} from 'lucide-react';

const ACTION_LABEL: Record<string, string> = {
  'shift.created': 'Смена запланирована',
  'shift.updated': 'Смена изменена',
  'shift.acceptance-requested': 'Запрошен допуск к работе',
  'shift.acceptance-declined': 'В допуске отказано',
  'shift.started': 'Смена допущена к работе',
  'shift.start-blocked': 'Запуск смены заблокирован',
  // Контур выдаёт этот код (`waiveShiftStartCommand`), а подписи для него не
  // было — в журнале он показывался сырым `shift.start-waived`.
  'shift.start-waived': 'Выдано разрешение на пуск',
  'shift.cancelled': 'Смена отменена',
  'handover.submitted': 'Смена передана диспетчеру',
  'handover.resubmitted': 'Передача сдана повторно',
  'handover.accepted': 'Передача принята',
  'handover.rework-requested': 'Передача возвращена на доработку',
  'work-permit.created': 'Наряд-допуск создан',
  'work-permit.updated': 'Наряд-допуск изменён',
  'work-permit.submit': 'Наряд отправлен на согласование',
  // Согласование пишется с ролью подписавшего: `approved-dispatcher` и
  // `approved-admin`. Кода `work-permit.approve` контур не выдаёт вовсе —
  // из-за него две подписи показывались в журнале сырыми кодами.
  'work-permit.approved-dispatcher': 'Наряд согласован диспетчером',
  'work-permit.approved-admin': 'Наряд согласован администратором',
  'work-permit.revoke': 'Наряд отозван',
  'defect.reported': 'Зафиксировано замечание',
  'defect.triage': 'Замечание разобрано',
  'defect.resolve': 'Замечание закрыто',
  'defect.reject': 'Замечание отклонено',
  'readiness.exported': 'Выгрузка данных готовности',
  published: 'Опубликованы правила готовности',
  // Код действия исторический: замещать можно любую из пяти ролей, и какую
  // именно — записано в самом событии. Подпись «за механика» врала бы на
  // мастере и инженере ОТ.
  acting_as_mechanic: 'Включён режим замещения роли',
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

/**
 * Свой значок каждому действию.
 *
 * Раньше журнал рисовал ровно две иконки — треугольник у критичных записей и
 * галочку у всех остальных. Но это дублировало колонку «Результат», которая
 * говорит то же самое словом, и не отвечало на вопрос, который человек задаёт
 * ленте на самом деле: ЧТО здесь произошло. Согласование, отзыв наряда,
 * правка правил и приёмка передачи выглядели одинаково.
 *
 * Тон отражает смысл события, а не его тяжесть: `warning` — что-то вернули на
 * доработку или изменили, `danger` — запретили или отменили, `success` —
 * подтвердили, `info` — передали дальше.
 */
export interface AuditActionMark {
  icon: LucideIcon;
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral';
}

const ACTION_MARK: Record<string, AuditActionMark> = {
  'shift.created': { icon: CalendarPlus, tone: 'info' },
  'shift.updated': { icon: Pencil, tone: 'warning' },
  'shift.acceptance-requested': { icon: Send, tone: 'info' },
  'shift.acceptance-declined': { icon: XCircle, tone: 'danger' },
  'shift.started': { icon: PlayCircle, tone: 'success' },
  'shift.start-blocked': { icon: ShieldAlert, tone: 'danger' },
  'shift.start-waived': { icon: KeyRound, tone: 'warning' },
  'shift.cancelled': { icon: XCircle, tone: 'danger' },
  'handover.submitted': { icon: Send, tone: 'info' },
  'handover.resubmitted': { icon: Send, tone: 'info' },
  'handover.accepted': { icon: Lock, tone: 'success' },
  'handover.rework-requested': { icon: Pencil, tone: 'warning' },
  'work-permit.created': { icon: FileText, tone: 'info' },
  'work-permit.updated': { icon: Pencil, tone: 'warning' },
  'work-permit.submit': { icon: Send, tone: 'info' },
  'work-permit.approved-dispatcher': { icon: CheckCircle2, tone: 'success' },
  'work-permit.approved-admin': { icon: CheckCircle2, tone: 'success' },
  'work-permit.revoke': { icon: Ban, tone: 'danger' },
  'defect.reported': { icon: AlertTriangle, tone: 'danger' },
  'defect.triage': { icon: Search, tone: 'info' },
  'defect.resolve': { icon: CheckCircle2, tone: 'success' },
  'defect.reject': { icon: XCircle, tone: 'warning' },
  'readiness.exported': { icon: Download, tone: 'neutral' },
  published: { icon: Upload, tone: 'success' },
  acting_as_mechanic: { icon: UserCog, tone: 'warning' },
};

/**
 * Запасной значок для кода, которого здесь ещё нет. Новое действие контура не
 * должно остаться без иконки, поэтому опираемся на признак критичности —
 * ровно то поведение, что было у всей ленты раньше.
 */
export function auditActionMark(action: string): AuditActionMark {
  return ACTION_MARK[action]
    ?? (isCriticalAuditAction(action)
      ? { icon: AlertTriangle, tone: 'danger' }
      : { icon: CheckCircle2, tone: 'success' });
}

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function auditEntityLabel(type: string): string {
  return ENTITY_LABEL[type] ?? (type || 'Контур');
}

export function isCriticalAuditAction(action: string): boolean {
  return CRITICAL_ACTIONS.has(action);
}
