import {createTelegramDeliveryProgress} from '@/core/notifications/telegram-delivery-progress';
import {alertSchema} from '@/core/notifications/durable-alert';

/**
 * Правило алерта → ключ настройки. У происшествия и дефекта осмотра — разные
 * выключатели, поэтому по одному `criticalDefect` их не различить; правило,
 * которого здесь нет, отправляем как раньше (новый отправитель не должен
 * молчать из-за того, что его забыли вписать в карту).
 *
 * Ключи перечислены здесь литералами, а не типом каталога настроек: `services/`
 * по правилам проекта не зависит от `modules/` (eslint no-restricted-imports).
 *
 * `incidentStopWork` (пострадавший или «прекратить работы») сюда НЕ вписан
 * намеренно: по решению владельца 26.09.2026 оно не выключается.
 */
const RULE_NOTIFICATION_KEYS: Record<string, 'criticalDefect' | 'incidents'> = {
  criticalDefect: 'criticalDefect',
  incident: 'incidents',
};

/** Existing outbox backoff and DLQ handle thrown delivery errors. */
export async function deliverQueuedAlert(event: {id?: string; tenantId?: string | null; data?: unknown}) {
  if (!event.id || !event.tenantId) throw new Error('Alert delivery requires event and tenant identity');
  const tenantId = event.tenantId;
  const {db} = await import('@/lib/db');
  const {telegramNotifier} = await import('@/core/notifications/telegram');
  const {isNotificationEnabled} = await import('@/modules/settings');
  const alert = alertSchema.parse(event.data);
  // Срочное происшествие (critical = пострадавший или «прекратить работы»)
  // не глушится, даже если записано до появления правила incidentStopWork
  // со старым ruleId 'incident' (решение владельца 26.09.2026).
  const urgentIncident = alert.ruleId === 'incident' && alert.severity === 'critical';
  const key = alert.notificationKey ?? (alert.ruleId && !urgentIncident ? RULE_NOTIFICATION_KEYS[alert.ruleId] : undefined);
  // Настройки тенанта читаем ДО транзакции (R85 §2): isNotificationEnabled идёт
  // через глобальный db, а внутри db.$transaction область помечена как «тенант
  // уже выставлен» (tenant-rls.ts runWithGucApplied), поэтому глобальное чтение
  // уходит без set_config, строгий RLS отдаёт ноль строк — вернулись бы значения
  // по умолчанию и выключатель владельца молча игнорировался бы.
  const suppressed = key ? !await isNotificationEnabled(tenantId, key) : false;
  // Serialize competing workers; a replay of an already delivered row is a no-op.
  // Telegram does not support idempotency keys: an ambiguous network failure can
  // still repeat a message. Include the stable event id for recognition.
  const complete = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${event.id} AND "tenantId" = ${event.tenantId} FOR UPDATE`;
    const row = await tx.outboxEvent.findFirst({where: {id: event.id, tenantId: event.tenantId}});
    if (!row || row.published) return true;
    if (!suppressed) {
      const progress = createTelegramDeliveryProgress(row.payload, async payload => {
        await tx.outboxEvent.update({where: {id: row.id}, data: {payload}});
      });
      const delivered = await telegramNotifier.sendAlert({...alert, message: alert.message + '\nСобытие: ' + event.id}, progress);
      // Commit acknowledged chats before throwing to the outbox retry loop.
      if (!delivered) return false;
    }
    await tx.outboxEvent.update({where: {id: row.id}, data: {published: true, publishedAt: new Date(), lastError: null}});
    return true;
  }, {timeout: 60_000});
  if (!complete) throw new Error('Telegram delivery failed; retained for retry');
}
