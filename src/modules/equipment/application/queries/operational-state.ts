import { db } from '@/lib/db';

/**
 * В каком состоянии установка прямо сейчас.
 *
 * ПОЧЕМУ ОДНО МЕСТО. Ответов было три. Дашборд и мониторинг считали «в работе»
 * тем, что за машину сдан отчёт за сегодня; контур готовности — тем, что на ней
 * открыта смена; карточка объекта завела третий. Диспетчер видел «0 в работе из
 * 8» и рядом смену «В работе» на Liebherr LRH 100 №1 — оба экрана были по-своему
 * правы и вместе бесполезны.
 *
 * ЧТО СЧИТАЕТСЯ РАБОТОЙ. Открытая смена. Отчёт сдают в конце смены, и до
 * вечера машина, которая работает с восьми утра, по отчёту выглядит стоящей.
 * Вопрос «сколько машин работает» задают днём, а не после сдачи отчётов.
 *
 * ПОРЯДОК. Ремонт перекрывает смену: открытая неисправность означает ремонт,
 * даже если смену на машине формально не закрыли. Тем же правилом уже жили
 * карточки парка («открытая поломка = в ремонте», 19cf9c3), и менять его здесь
 * значило бы разойтись с ними.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Телеметрии. Пока коробка не подключена, «работает» — это
 * «открыта смена», а не «двигатель заведён». Когда телеметрия появится, менять
 * придётся одно это место.
 */
export type EquipmentOperationalState = 'working' | 'repair' | 'idle';

export async function resolveEquipmentOperationalStates(
  tenantId: string,
  equipmentIds: string[],
): Promise<Record<string, EquipmentOperationalState>> {
  if (!tenantId || equipmentIds.length === 0) return {};

  const [running, repairs] = await Promise.all([
    db.shift.findMany({
      where: {
        tenantId,
        equipmentId: { in: equipmentIds },
        state: { in: ['STARTED', 'HANDOVER_PENDING'] },
      },
      select: { equipmentId: true },
    }),
    db.maintenanceRecord.findMany({
      where: {
        equipmentId: { in: equipmentIds },
        type: { in: ['REPAIR', 'FAULT'] },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      select: { equipmentId: true },
    }),
  ]);

  const states: Record<string, EquipmentOperationalState> = {};
  for (const id of equipmentIds) states[id] = 'idle';
  for (const row of running) states[row.equipmentId] = 'working';
  // Ремонт последним — он перекрывает открытую смену.
  for (const row of repairs) states[row.equipmentId] = 'repair';
  return states;
}
