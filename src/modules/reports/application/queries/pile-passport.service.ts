import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';

/**
 * Журнал забивки свай — публичный фасад (W46).
 *
 * ЧТО ЗДЕСЬ ОСТАЛОСЬ. Решение мастера по свае (`decidePilePassport`) — это
 * запись, а не чтение, и в разрезание журнала на список/итоги/выгрузку оно не
 * входит. Остальное — только реэкспорт: экран, `route.ts`, `export/route.ts` и
 * тесты импортируют те же имена, что и раньше, и о разделении не знают.
 *
 * ПОЧЕМУ РАЗДЕЛИЛИ. Файл перерос 500 строк и держал четыре независимые
 * ответственности: строки журнала, агрегат итогов периода, титул документа и
 * выгрузку .xlsx. Теперь правку колонки выгрузки нельзя случайно задеть чтением
 * списка. Реализация — в файлах рядом:
 * - `pile-journal-list` — строки журнала из записей выработки (`listPilePassports`);
 * - `pile-journal-totals` — агрегат итогов периода, титул, экранирование LIKE;
 * - `pile-journal-export` — нормативный журнал в .xlsx (`exportPileJournalXlsx`);
 * - `pile-journal-types` — общие типы и константы журнала.
 *
 * Поведение при разделении не менялось.
 */

export {
  PILE_JOURNAL_LIMIT,
  PILE_JOURNAL_EXPORT_LIMIT,
} from './pile-journal-types';
export type {
  PileDrivingSetRow,
  PilePassportRow,
  PileJournalHeader,
  PileJournalFilters,
  PileJournalTotals,
  PileJournalPage,
} from './pile-journal-types';
export { listPilePassports } from './pile-journal-list';
export { pileJournalHeader } from './pile-journal-totals';
export { exportPileJournalXlsx } from './pile-journal-export';

/**
 * Решение мастера по свае.
 *
 * ПОЧЕМУ РЕШЕНИЕ МОЖНО ПЕРЕСМОТРЕТЬ. Сваю отправили на добивку, добили, отказ
 * сошёлся — и её принимают. Запрет на второе решение заставил бы заводить
 * вторую сваю с тем же номером, то есть врать в журнале.
 *
 * ПОЧЕМУ ОБЯЗАТЕЛЬНА ПРИЧИНА У ДОБИВКИ. «Не принята» без основания —
 * распоряжение, которое машинист не может выполнить: он не знает, что не так.
 */
export async function decidePilePassport(input: {
  tenantId: string;
  passportId: string;
  actorId: string;
  acceptance: 'ACCEPTED' | 'NEEDS_REDRIVE';
  note?: string;
}): Promise<void> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const note = input.note?.trim() || null;
  if (input.acceptance === 'NEEDS_REDRIVE' && !note) {
    throw new ServiceError('Укажите, почему свая идёт на добивку', 400);
  }

  // Строгое равенство по организации: чужой паспорт этим решением не тронуть.
  const updated = await db.pilePassport.updateMany({
    where: { id: input.passportId, tenantId: input.tenantId },
    data: {
      acceptance: input.acceptance,
      acceptedById: input.actorId,
      acceptedAt: new Date(),
      acceptanceNote: note,
    },
  });

  if (updated.count === 0) throw new ServiceError('Паспорт сваи не найден', 404);
}
