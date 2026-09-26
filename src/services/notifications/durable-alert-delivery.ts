import {alertSchema} from '@/core/notifications/durable-alert';

/**
 * Правило алерта → ключ настройки. У происшествия и дефекта осмотра — разные
 * выключатели, поэтому по одному `criticalDefect` их не различить; правило,
 * которого здесь нет, отправляем как раньше (новый отправитель не должен
 * молчать из-за того, что его забыли вписать в карту).
 *
 * Ключи перечислены здесь литералами, а не типом каталога настроек: `services/`
 * по правилам проекта не зависит от `modules/` (eslint no-restricted-imports).
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
  // Serialize competing workers; a replay of an already delivered row is a no-op.
  // Telegram does not support idempotency keys: an ambiguous network failure can
  // still repeat a message. Include the stable event id for recognition.
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${event.id} AND "tenantId" = ${event.tenantId} FOR UPDATE`;
    const row = await tx.outboxEvent.findFirst({where: {id: event.id, tenantId: event.tenantId}});
    if (!row || row.published) return;
    const key = alert.ruleId ? RULE_NOTIFICATION_KEYS[alert.ruleId] : undefined;
    const suppressed = key ? !await isNotificationEnabled(tenantId, key) : false;
    if (!suppressed) {
      const delivered = await telegramNotifier.sendAlert({...alert, message: alert.message + '\nСобытие: ' + event.id});
      if (!delivered) throw new Error('Telegram delivery failed; retained for retry');
    }
    await tx.outboxEvent.update({where: {id: row.id}, data: {published: true, publishedAt: new Date(), lastError: null}});
  }, {timeout: 15_000});
}
