export type WorkPermitRisk = 'NORMAL' | 'ELEVATED';
export type WorkPermitState = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
export type WorkPermitApprovalRole = 'DISPATCHER' | 'ADMIN';

export interface WorkPermitApprovalRecord {
  role: WorkPermitApprovalRole;
  approvedById: string;
  permitVersion: number;
  valid: boolean;
}

export interface WorkPermitRecord {
  id: string;
  tenantId: string;
  equipmentId: string;
  shiftId: string | null;
  workTypeId: string | null;
  risk: WorkPermitRisk;
  state: WorkPermitState;
  /**
   * Снимок требования к подписям на момент оформления — какие роли обязаны
   * согласовать и может ли автор подписать свой наряд. Берётся из вида работ,
   * но хранится здесь: читай правило живьём — и правка справочника переписала
   * бы уже подписанное прошлое.
   */
  requiredApprovals: WorkPermitApprovalRole[];
  allowAuthorApproval: boolean;
  title: string;
  scope: string;
  location: string;
  objectName: string;
  hazards: string[];
  producerUserId: string | null;
  producerName: string;
  observerUserId: string | null;
  observerName: string;
  safetyUserId: string | null;
  safetyName: string;
  validFrom: Date;
  validTo: Date;
  timezone: string;
  authorId: string;
  lastEditedById: string;
  version: number;
  approvals: WorkPermitApprovalRecord[];
}

/**
 * Содержание наряда — то, что подписывают. Правка любого поля отсюда
 * аннулирует уже поставленные подписи (см. editPermit).
 *
 * Поля намеренно плоские, один в один с колонками таблицы: содержание
 * валидируется и пишется целиком, и лишний слой вложенности здесь дал бы
 * только ручное перекладывание туда-обратно.
 */
export interface WorkPermitContent {
  equipmentId: string;
  shiftId?: string | null;
  /** Вид работ из справочника. null — только у нарядов до 16.08.2026. */
  workTypeId: string | null;
  risk: WorkPermitRisk;
  /** Наименование работ — короткая строка для реестра. */
  title: string;
  /** Описание работ — то, что раньше называлось «состав и границы работ». */
  scope: string;
  location: string;
  objectName: string;
  hazards: string[];
  /**
   * Ответственные лица. У каждого пара «учётка или ничего» + ФИО.
   * ФИО заполнено ВСЕГДА: это снимок на момент оформления, он переживает
   * переименование и удаление учётной записи. Учётка — вспомогательная связь.
   */
  producerUserId: string | null;
  producerName: string;
  observerUserId: string | null;
  observerName: string;
  safetyUserId: string | null;
  safetyName: string;
  validFrom: Date;
  validTo: Date;
}
