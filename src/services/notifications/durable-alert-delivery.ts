import {alertSchema} from '@/core/notifications/durable-alert';

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
    const suppressed = alert.ruleId === 'criticalDefect' && !await isNotificationEnabled(tenantId, 'criticalDefect');
    if (!suppressed) {
      const delivered = await telegramNotifier.sendAlert({...alert, message: alert.message + '\nСобытие: ' + event.id});
      if (!delivered) throw new Error('Telegram delivery failed; retained for retry');
    }
    await tx.outboxEvent.update({where: {id: row.id}, data: {published: true, publishedAt: new Date(), lastError: null}});
  }, {timeout: 15_000});
}
