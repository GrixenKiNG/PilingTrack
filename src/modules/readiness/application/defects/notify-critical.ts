import {logger} from '@/lib/logger';

/**
 * Оповещение об опасном дефекте установки.
 *
 * ЗАЧЕМ. Дефект — единственное место, где у неисправности появляется владелец и
 * срок. Заводился он исправно и был виден в журнале, но никого не будил:
 * механик узнавал о запрете эксплуатации, только если сам открывал экран. Между
 * «машинист отметил трещину в мачте» и «кто-то это увидел» стояла смена.
 *
 * ЧТО СЧИТАЕТСЯ ОПАСНЫМ. `HIGH` и `CRITICAL` — ровно те, по которым контур
 * готовности рисует красное предупреждение (`domain/work-warnings.ts`,
 * `OPEN_ALERT_DEFECT`). Второго определения «критичности» в продукте заводить
 * нельзя: разошедшись, они дадут дефект, красный на экране и молчащий в чате.
 *
 * ПОЧЕМУ ОДНО СООБЩЕНИЕ НА ОСМОТР. Обход выдаёт неисправности пачкой. Три
 * отдельных сигнала об одной машине читаются как три поломки, а не как один
 * осмотр, — и на четвёртой смене их перестают открывать.
 *
 * ПОЧЕМУ НИЧЕГО НЕ БРОСАЕТ. Отправка идёт после записи и вне транзакции: дефект
 * уже в журнале, и молчащий Telegram не повод отменить осмотр или потерять
 * команду. Тем же правилом живут оповещения о происшествии и о простое.
 */
export async function notifyCriticalDefects(input: {
  tenantId: string;
  equipmentId: string;
  /** Кто зафиксировал: машинист, помощник, диспетчер. */
  reportedBy: string;
  defects: {severity: string; title: string}[];
}): Promise<void> {
  const alerting = input.defects.filter(
    (defect) => defect.severity === 'HIGH' || defect.severity === 'CRITICAL',
  );
  if (alerting.length === 0) return;

  try {
    const {isNotificationEnabled} = await import('@/modules/settings');
    if (!await isNotificationEnabled(input.tenantId, 'criticalDefect')) {
      logger.info('Critical defect alert suppressed by tenant settings', {
        equipmentId: input.equipmentId, count: alerting.length,
      });
      return;
    }

    const {db} = await import('@/lib/db');
    // Строгое равенство по тенанту: `IS NULL OR` здесь вернул бы название
    // чужой установки в чат этой организации.
    const equipment = await db.equipment.findFirst({
      where: {tenantId: input.tenantId, id: input.equipmentId},
      select: {name: true},
    });

    const forbidden = alerting.some((defect) => defect.severity === 'CRITICAL');
    const machine = equipment?.name ?? 'установка';
    const lines = alerting.map((defect) => `• ${defect.title}`).join('\n');

    const {telegramNotifier} = await import('@/core/notifications/telegram');
    await telegramNotifier.sendAlert({
      severity: forbidden ? 'critical' : 'high',
      message: [
        forbidden
          ? `${machine}: эксплуатация запрещена.`
          : `${machine}: неисправность, устранить как можно скорее.`,
        lines,
        `Зафиксировал: ${input.reportedBy}. Разбор — в журнале дефектов.`,
      ].join('\n'),
    });
  } catch (error) {
    logger.error('Failed to notify about critical defect', error, {
      equipmentId: input.equipmentId,
    });
  }
}
