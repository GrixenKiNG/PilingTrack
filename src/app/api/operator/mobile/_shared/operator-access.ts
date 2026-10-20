import {canActAs, resolveEffectiveRole} from '@/lib/types';

/**
 * Кто работает на мобильном месте машиниста.
 *
 * Права считаются по эффективной роли: при замещении это исполняемая роль, а
 * не настоящая. Замещение разрешено только администратору — `requireAuth`
 * уже сбрасывает чужую роль, но здесь проверка повторяется, чтобы доступ к
 * экрану не зависел от соседнего слоя.
 *
 * `operatorId` — реальный пользователь. Его id пишется в журнал, поэтому
 * действие администратора всегда видно как сделанное администратором.
 */
export interface OperatorAccess {
  operatorId: string;
  /** Исполняемая роль при замещении; `null`, когда машинист работает сам. */
  actingAs: 'OPERATOR' | null;
}

export function resolveOperatorAccess(user: {id: string; role: string; actingAs: string | null | undefined}): OperatorAccess | null {
  if (resolveEffectiveRole(user.role, user.actingAs) !== 'OPERATOR') return null;

  // `canActAs` требует роль ADMIN и известную исполняемую роль.
  const acting = Boolean(user.actingAs) && canActAs(user.role, user.actingAs);
  return {operatorId: user.id, actingAs: acting ? 'OPERATOR' : null};
}
