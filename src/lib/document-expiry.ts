/**
 * Срок годности документа: чистая математика, без обращений к базе.
 *
 * Живёт в lib по образцу pm-due.ts: одну и ту же оценку показывают и сервер
 * (список просроченного для диспетчера), и интерфейс (плашка в карточке
 * работника). Разъехавшись, они дали бы «просрочено» на экране и «в порядке»
 * в выборке — расхождение, которое замечают не сразу.
 */

export type DocumentExpiryStatus = 'perpetual' | 'ok' | 'expiring' | 'expired';

export interface DocumentExpiry {
  status: DocumentExpiryStatus;
  /** Дней до окончания срока; отрицательное — просрочено. null у бессрочных. */
  daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/**
 * `leadTimeDays` — за сколько дней предупреждать (у видов документов по
 * умолчанию 30). Бессрочный документ (`expiresAt === null`) никогда не
 * становится просроченным: таких в законодательстве хватает, и заставлять
 * заводить фиктивную дату нельзя.
 */
export function documentExpiry(
  expiresAt: Date | string | null | undefined,
  leadTimeDays: number,
  now: Date = new Date(),
): DocumentExpiry {
  if (expiresAt == null || expiresAt === '') return { status: 'perpetual', daysLeft: null };
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return { status: 'perpetual', daysLeft: null };

  // Округляем вверх: документ, истекающий сегодня в 23:59, — это «остался 1
  // день», а не «ноль». Ноль в интерфейсе читается как «уже всё».
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= leadTimeDays) return { status: 'expiring', daysLeft };
  return { status: 'ok', daysLeft };
}

export const DOCUMENT_EXPIRY_LABELS: Record<DocumentExpiryStatus, string> = {
  perpetual: 'бессрочный',
  ok: 'действует',
  expiring: 'истекает',
  expired: 'просрочен',
};
