import { logger } from '@/lib/logger';

/**
 * Организация по умолчанию нужна всем безсессионным путям: вебхуку Alertmanager,
 * Telegram-отправителю без контекста, форме заявок ORION, алертам очереди
 * недоставленных. Без неё они молча деградируют. validate-env запускается при
 * сборке и не видит рабочих переменных, поэтому проверка идёт на старте.
 * Приложение не останавливаем: вход и работа с отчётами от неё не зависят.
 */
export function reportMissingDefaultTenant(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  if (env.DEFAULT_TENANT_ID?.trim()) return false;
  logger.error(
    'DEFAULT_TENANT_ID не задана: Telegram-алерты, вебхук мониторинга, заявки ORION и очередь недоставленных работают без организации. Задайте переменную в .env и в docker-compose.yml.',
  );
  return true;
}
