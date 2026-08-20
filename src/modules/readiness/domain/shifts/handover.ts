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
 * Свою передачу не принимает никто — ни оператор, ни администратор.
 *
 * Правило проверяет человека, а не роль. Оператор получил право принимать
 * технику, потому что при второй смене её принимает следующий оператор, а не
 * диспетчер (решение владельца 20.08.2026). Без этой проверки тот же оператор
 * закрывал бы собственную смену своей же подписью, и передача перестала бы
 * что-либо подтверждать. Та же логика, что у наряда повышенного риска:
 * подписи должны принадлежать разным людям.
 */
export function assertHandoverAcceptedByAnotherPerson(submittedById: string, actorId: string): void {
  if (submittedById === actorId) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 409,
      'Свою передачу принимает другой оператор или диспетчер');
  }
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
