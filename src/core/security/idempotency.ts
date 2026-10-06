/**
 * Очистка таблицы IdempotencyKey.
 *
 * Здесь же раньше жили withIdempotency / acquireIdempotencyKey /
 * completeIdempotencyKey / failIdempotencyKey — их не вызывал ни один
 * маршрут, а независимый аудит (Codex out55, F07, F08, F15, F16) нашёл в них
 * неатомарный перехват «зависшего» ключа, отсутствие проверки срока при
 * чтении, потерю falsy-результатов и раскрытие текста внутренней ошибки при
 * повторе. Удалены 01.10.2026, чтобы их не подключили по ошибке: живая защита
 * от двойной отправки — конвейер команд техготовности
 * (src/modules/readiness/application/command-pipeline/).
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Delete expired idempotency keys.
 * Run weekly via cron or worker.
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const result = await db.idempotencyKey.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }, // Older than 7 days
      ],
    },
  });

  if (result.count > 0) {
    logger.info('Cleaned up expired idempotency keys', { count: result.count });
  }

  return result.count;
}
