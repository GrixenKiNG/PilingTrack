import type { AuditDescription } from './audit-description-helpers';
import { ADMIN_DESCRIPTIONS } from './audit-descriptions-admin';
import { EQUIPMENT_DESCRIPTIONS } from './audit-descriptions-equipment';
import { INCIDENT_REPORT_DESCRIPTIONS } from './audit-descriptions-incidents-reports';

/**
 * Ленту читает владелец, а не программист: машинный код действия
 * («user.document_type.created») и фраза «Событие аудита в контуре users» не
 * сообщают ему ни что произошло, ни с чем. Журнал, который невозможно
 * прочитать, контролем не является.
 *
 * Добавляя новый recordAuditEvent, добавьте сюда строку — иначе событие снова
 * уедет в общий default и в ленте появится машинный код.
 */
export const AUDIT_DESCRIPTIONS: Record<string, AuditDescription> = {
  ...INCIDENT_REPORT_DESCRIPTIONS,
  ...ADMIN_DESCRIPTIONS,
  ...EQUIPMENT_DESCRIPTIONS,
};
