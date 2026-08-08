import type {ReadinessHandoverDto, ReadinessShiftDto, WorkPermitDto} from './api/contracts';

/**
 * Русские подписи для состояний контура техготовности.
 *
 * Значения вроде PENDING_APPROVAL — внутренние коды, они не должны попадать
 * на экран: пользователь читает по-русски. Списки должны покрывать все
 * значения контракта, поэтому типы взяты из него, а не написаны заново.
 */
export const SHIFT_STATE_LABEL: Record<ReadinessShiftDto['state'], string> = {
  PLANNED: 'Запланирована',
  STARTED: 'В работе',
  HANDOVER_PENDING: 'Ждёт приёмки',
  CLOSED: 'Закрыта',
  CANCELLED: 'Отменена',
};

export const SHIFT_TYPE_LABEL: Record<ReadinessShiftDto['type'], string> = {
  DAY: 'Дневная',
  NIGHT: 'Ночная',
};

export const PERMIT_STATE_LABEL: Record<WorkPermitDto['state'], string> = {
  DRAFT: 'Черновик',
  PENDING_APPROVAL: 'На согласовании',
  APPROVED: 'Согласован',
  EXPIRED: 'Истёк',
  REVOKED: 'Отозван',
};

export const HANDOVER_STATE_LABEL: Record<ReadinessHandoverDto['state'], string> = {
  DRAFT: 'Черновик',
  SUBMITTED: 'Передана',
  ACCEPTED: 'Принята',
  REWORK_REQUESTED: 'Возвращена на доработку',
};
