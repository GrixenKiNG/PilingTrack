import {ReadinessCommandError} from '../../application/command-pipeline/errors';

export function validateHandoverSummary(value: string): string {
  const summary = value.trim();
  if (summary.length < 3 || summary.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Состояние техники: от 3 до 4000 символов');
  }
  return summary;
}

/*
  Принимает и отсутствующую причину. Вызывающий передавал `input.reason!` —
  утверждение «причина точно есть» поверх типа, который её допускал не быть.
  Обещание держалось на вызове через revokeHandover; при обращении мимо него
  сюда пришёл бы undefined и `value.trim()` упал бы TypeError вместо понятного
  отказа. Проверка причины — работа этой функции, ей и разбираться с пустотой.
*/
export function requireReworkReason(value: string | undefined): string {
  const reason = value?.trim() ?? '';
  if (reason.length < 3 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Причина возврата: от 3 до 1000 символов');
  }
  return reason;
}

/**
 * Свою передачу принять МОЖНО — решение владельца 27.08.2026.
 *
 * ПОЧЕМУ ЗАПРЕТ СНЯТ. До этого действовало правило «подписи принадлежат разным
 * людям», как у наряда повышенного риска. На бумаге верное, на практике
 * неисполнимое: за установкой закреплена ровно ОДНА активная бригада — это
 * держит частичный уникальный индекс `Crew_equipmentId_active_unique`, — то
 * есть у машины в каждый момент один оператор. При работе в одну смену принять
 * передачу физически некому, и смена оставалась в `HANDOVER_PENDING` навсегда:
 * следующую открыть нельзя, машина заперта. Правило, которое нельзя выполнить,
 * не защищает — оно останавливает работу.
 *
 * ЧТО ОСТАЛОСЬ ВМЕСТО ЗАПРЕТА. Самоприёмка не запрещена, но и не спрятана: факт
 * «принял тот же человек, что и сдавал» уходит в журнал отдельным признаком
 * (`selfAccepted` в событии приёмки). Диспетчер видит, где передача никем не
 * проверялась, и это остаётся поводом спросить — но уже разбором, а не
 * блокировкой машины.
 *
 * Наряда повышенного риска это НЕ касается: там две подписи проверяет своя
 * политика (`domain/permits/approval-policy.ts`), и она не изменилась.
 */
export function isSelfAcceptedHandover(submittedById: string, actorId: string): boolean {
  return submittedById === actorId;
}

/**
 * Оператор не сдаёт смену, пока не отправлен сменный отчёт.
 *
 * Требование адресное, а не общее: этой же командой механик возвращает
 * технику после ремонта, и у его передачи сменного отчёта нет и быть не
 * должно. Проверяется исполняемая роль, а не учётная: администратор в режиме
 * «действую как оператор» сдаёт смену по тем же правилам, что оператор.
 */
export function assertShiftReportSubmitted(
  effectiveRole: string,
  hasSubmittedReport: boolean,
): void {
  if (effectiveRole !== 'OPERATOR') return;
  if (!hasSubmittedReport) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 409,
      'Сначала отправьте сменный отчёт — он и есть содержание передачи');
  }
}
