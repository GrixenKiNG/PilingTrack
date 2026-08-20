import {ReadinessCommandError} from '../../application/command-pipeline/errors';

/**
 * Отпечаток препятствий, на которые выдано разрешение на пуск.
 *
 * Разрешение диспетчера — не индульгенция машине, а решение по КОНКРЕТНОМУ
 * набору препятствий: «знаю про течь и просроченное ТО, выпускаю под свою
 * ответственность». Если к моменту пуска появилось новое препятствие,
 * разрешение его не покрывает — нужно новое решение.
 *
 * Отпечаток строится из условий блокировщиков, а не из хэша фактов: хэш фактов
 * меняется от любой мелочи (сдвинулись моточасы, прошло время), и разрешение
 * переставало бы действовать через минуту после выдачи.
 */
export function blockerFingerprint(
  // Блокировщик приходит в двух формах: правило из набора организации несёт
  // `condition`, а зашитый в код отказ — `code`. Обе означают одно и то же —
  // «что именно мешает», — поэтому отпечаток принимает любую.
  blockers: readonly {condition?: string; code?: string}[],
): string {
  const conditions = blockers
    .map((blocker) => blocker.condition ?? blocker.code)
    .filter((value): value is string => Boolean(value));
  return [...new Set(conditions)].sort().join(',');
}

/**
 * Покрывает ли выданное разрешение текущие препятствия.
 *
 * Пустой набор препятствий покрывается всегда — пуск и так разрешён.
 * Разрешение действует, пока набор препятствий не изменился: исчезли —
 * тем лучше, появились новые — разрешение не действует.
 */
export function waiverCoversBlockers(issuedFingerprint: string, currentFingerprint: string): boolean {
  if (currentFingerprint === '') return true;
  const issued = new Set(issuedFingerprint.split(',').filter(Boolean));
  return currentFingerprint.split(',').filter(Boolean).every((condition) => issued.has(condition));
}

export function requireWaiverReason(value: string | undefined): string {
  const reason = value?.trim() ?? '';
  if (reason.length < 10 || reason.length > 1000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422,
      'Причина разрешения: от 10 до 1000 символов — её будут читать при разборе');
  }
  return reason;
}
