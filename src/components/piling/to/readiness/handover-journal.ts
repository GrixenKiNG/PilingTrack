import type { ReadinessBootstrap, ReadinessShiftDto } from './api/contracts';

/**
 * Журнал передачи и приёмки смены.
 *
 * Раньше на этом месте выводились пять постоянных подписей этапов, к которым
 * подставлялись последние записи журнала ТО — то есть журнал показывал
 * «Запрошены доработки» напротив планового обслуживания. Здесь события строятся
 * только из того, что действительно произошло с ShiftHandover: этап попадает в
 * список, если у него есть отметка времени.
 */
export type HandoverEventKind = 'SUBMITTED' | 'REWORKED' | 'ACCEPTED';

export interface HandoverJournalEvent {
  id: string;
  kind: HandoverEventKind;
  label: string;
  occurredAt: string;
  /** Имя из справочника участников; null, если пользователь недоступен. */
  actorName: string | null;
  actorRole: string | null;
  comment: string | null;
  packageVersion: number;
}

const EVENT_LABEL: Record<HandoverEventKind, string> = {
  SUBMITTED: 'Передано диспетчеру',
  REWORKED: 'Возвращено на доработку',
  ACCEPTED: 'Принято диспетчером',
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер',
  OPERATOR: 'Оператор',
  ASSISTANT: 'Помощник',
  MECHANIC: 'Механик',
  FOREMAN: 'Мастер',
  SAFETY_ENGINEER: 'Инженер ОТ',
};

export function handoverRoleLabel(role: string | null): string | null {
  if (!role) return null;
  return ROLE_LABEL[role] ?? role;
}

export function buildHandoverJournal(
  shifts: readonly ReadinessShiftDto[],
  equipmentId: string,
  actors: ReadinessBootstrap['selectors']['actors'] = [],
): HandoverJournalEvent[] {
  const byId = new Map(actors.map((actor) => [actor.id, actor]));
  const resolve = (id: string | null) => {
    const actor = id ? byId.get(id) : undefined;
    return { actorName: actor?.name ?? null, actorRole: actor?.role ?? null };
  };

  const events: HandoverJournalEvent[] = [];
  for (const shift of shifts) {
    if (shift.equipmentId !== equipmentId) continue;
    for (const handover of shift.handovers) {
      const add = (kind: HandoverEventKind, at: string | null, actorId: string | null, comment: string | null) => {
        if (!at) return;
        events.push({
          id: `${handover.id}:${kind}`,
          kind,
          label: EVENT_LABEL[kind],
          occurredAt: at,
          comment,
          packageVersion: handover.version,
          ...resolve(actorId),
        });
      };
      add('SUBMITTED', handover.submittedAt, handover.submittedById, handover.summary);
      add('REWORKED', handover.reworkedAt, handover.reworkedById, handover.reworkReason);
      add('ACCEPTED', handover.acceptedAt, handover.acceptedById, null);
    }
  }

  return events.sort((left, right) =>
    new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}
