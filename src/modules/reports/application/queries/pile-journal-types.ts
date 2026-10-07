import { zonedDayStartUtc } from '@/lib/timezone';
import {
  actualRefusalMm,
  drivingComplete,
  journalRefusalMm,
  redriveReadyAt,
  setRefusalMm,
  suggestAcceptance,
  type DrivingSet,
  type PileAcceptanceValue,
} from '@/modules/operator-mobile/domain/pile-passport';

// Единственная точка, где журнал забивки берёт правила из operator-mobile
// (граница слоёв: одно grandfathered-нарушение, как было в одном файле до W46).
export {
  actualRefusalMm,
  drivingComplete,
  journalRefusalMm,
  redriveReadyAt,
  setRefusalMm,
  suggestAcceptance,
};
export type { DrivingSet, PileAcceptanceValue };

/**
 * Журнал забивки свай.
 *
 * ЧТО ЭТО ЗА ДОКУМЕНТ. Не список записей, а нормативный журнал (СП 45.13330,
 * бывш. СНиП 3.02.01-87): титул с копром, молотом и проектными величинами,
 * затем строки по сваям с погружением от каждого залога, отказом и решением.
 * Свая уходит под землю навсегда — журнал единственное, что от неё остаётся.
 *
 * ЧЬЁ ЭТО МЕСТО. Машинист забивает сваю и записывает замеры. Принимает её
 * мастер: он отвечает за участок и решает, годится свая или пойдёт на добивку.
 * Диспетчер про сваи не решает — он ведёт смены и разбирает дефекты.
 *
 * ПОЧЕМУ ОТКАЗ СЧИТАЕТСЯ ЗДЕСЬ, А НЕ ХРАНИТСЯ. В паспорте лежат замеры
 * залогов; отказ — их среднее. Правило одно на весь продукт
 * (`operator-mobile/domain/pile-passport`), и телефон машиниста, и этот экран
 * показывают одно число.
 *
 * ПОЧЕМУ ТИПЫ ОТДЕЛЬНО (W46). Строку журнала собирает список, считает агрегат
 * итогов, печатает выгрузка .xlsx — все три обязаны описывать одну и ту же
 * строку. Общий словарь строк держим в одном файле, иначе типы разъедутся.
 */

export interface PileDrivingSetRow {
  ordinal: number;
  blows: number;
  penetrationMm: number;
  dropHeightM: number | null;
  /** Отказ на этом залоге, мм/удар. Считается, не хранится. */
  refusalMm: number | null;
}

export interface PilePassportRow {
  /** Ключ строки: паспорт, если он есть, иначе запись выработки. */
  id: string;
  /** Запись выработки, из которой построена строка журнала. */
  pileWorkId: string;
  /** Паспорт сваи. `null` — свая записана без паспорта (пачкой). */
  passportId: string | null;
  /** Есть паспорт. Только у такой строки показывают замеры и решение. */
  hasPassport: boolean;
  /** Строка из отчёта-черновика: решение по ней ещё не окончательное. */
  isDraft: boolean;
  /** Сколько свай в записи. Отрицательное число — поправка к выработке. */
  count: number;
  /** Номер сваи по проекту. `null` — паспорта нет, номера взять негде. */
  pileNumber: string | null;
  drivenAt: string;
  siteName: string;
  /** Смена, в которую забита свая (DAY/NIGHT). `null` — отчёт не привязан. */
  shiftType: string | null;
  /** Куст и пикет по проекту — где эта свая стоит. Пусто, если не привязана. */
  locationName: string | null;
  operatorName: string;
  equipmentName: string | null;
  recordedByForeman: boolean;
  pileGradeName: string;
  pileSection: string | null;
  pileLengthM: number | null;
  designHeadLevelM: number | null;
  actualHeadLevelM: number | null;
  drivenDepthM: number | null;
  followerUsed: boolean;
  redriven: boolean;
  headCutOff: boolean;
  refusalSetPenetrationMm: number | null;
  refusalSetBlows: number | null;
  designRefusalMm: number | null;
  /** Считается из залогов (по трём последним), в базе не хранится. */
  refusalMm: number | null;
  /** По скольким залогам посчитан отказ. По норме их три. */
  refusalSetsUsed: number;
  /** Залоги по порядку — построчная часть нормативной формы. */
  sets: PileDrivingSetRow[];
  /** Три последних залога дали отказ не больше проектного. `null` — нечем судить. */
  drivingComplete: boolean | null;
  totalBlows: number | null;
  blowsLastMeter: number | null;
  planDeviationMm: number | null;
  tiltPercent: number | null;
  hammerType: string | null;
  hammerEnergyKj: number | null;
  dropHeightM: number | null;
  note: string | null;
  /** Решение мастера. `null` — паспорта нет, решать нечего. */
  acceptance: PileAcceptanceValue | null;
  acceptanceNote: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  /**
   * Когда сваю, отправленную на добивку, можно добивать: грунту нужен отдых.
   * `null` — свая не на добивке.
   */
  redriveReadyAt: string | null;
  /** Что подсказать мастеру; `null` — проектного отказа нет, сравнивать нечего. */
  suggestion: { value: PileAcceptanceValue; reason: string } | null;
}

/** Титул журнала: чем и по каким проектным величинам била эта выборка. */
export interface PileJournalHeader {
  siteNames: string[];
  /** Копры, которыми забиты сваи выборки. */
  equipmentNames: string[];
  /** Молоты из паспортов — снимок на момент забивки, а не карточка установки. */
  hammerTypes: string[];
  hammerEnergyKj: number[];
  designRefusalMm: number[];
  dateFrom: string | null;
  dateTo: string | null;
  /** «Свай (всего)» — сваи за период, а не за показанную страницу. */
  pilesTotal: number;
  /** «из них в черновиках» — сваи из отчётов-черновиков. */
  draftPiles: number;
  /** «Свай без паспорта» — сваи, записанные пачкой. */
  withoutPassportPiles: number;
  /** «Паспортов принято» — единица счёта паспорт, не свая. */
  accepted: number;
  /** «Паспортов на добивку». */
  needsRedrive: number;
  /** «Паспортов не разобрано». */
  pending: number;
  /** Строк в выборке за период — для «Показано N из M записей». */
  rowsTotal: number;
}

export interface PileJournalFilters {
  tenantId: string;
  siteId?: string;
  /** Только неразобранные — рабочий список мастера. */
  pendingOnly?: boolean;
  /** Точная выборка по решению. Сильнее, чем `pendingOnly`. */
  acceptance?: PileAcceptanceValue;
  /** Границы по дате забивки, YYYY-MM-DD включительно. */
  dateFrom?: string;
  dateTo?: string;
  /** Пояс, в котором считается день периода. Без него — из настроек тенанта. */
  timezone?: string;
  /** Поиск по номеру сваи. */
  pileNumber?: string;
  limit?: number;
}

/**
 * Предел строк журнала на экране.
 *
 * ПОЧЕМУ ЭКРАН И ВЫГРУЗКА РАЗНЫЕ. Экран — рабочее место: 500 строк читаются, а
 * больше листать нечем. Выгрузка — нормативный документ (СП 45.13330): обрезать
 * его нельзя, поэтому у неё свой, высокий предел (`PILE_JOURNAL_EXPORT_LIMIT`),
 * а титул в обоих случаях считается по всему периоду одним агрегатом, не по
 * показанной странице.
 */
export const PILE_JOURNAL_LIMIT = 500;

/**
 * Предел строк журнала в выгрузке .xlsx.
 *
 * Настоящий журнал может быть на тысячи строк, и обрезать его — значит отдать
 * подрядчику неполный исполнительный документ. Потолок всё же нужен: файл
 * держится в памяти целиком. Если и его не хватит, шапка файла честно скажет
 * об этом (строка-предупреждение), а не промолчит.
 */
export const PILE_JOURNAL_EXPORT_LIMIT = 20000;

/** Итоги периода — по всему периоду, а не по показанной странице. */
export interface PileJournalTotals {
  /** «Свай (всего)»: Σ count по всем строкам периода. */
  piles: number;
  /** «из них в черновиках»: Σ count строк отчётов-черновиков. */
  draftPiles: number;
  /** «Свай без паспорта»: Σ count строк, у которых паспорта нет. */
  withoutPassportPiles: number;
  /** Паспорта по решению мастера — единица счёта паспорт, не свая. */
  accepted: number;
  needsRedrive: number;
  pending: number;
  /** Строк в выборке за период (не свай) — для «Показано N из M записей». */
  rows: number;
}

export interface PileJournalPage {
  rows: PilePassportRow[];
  /** Строк в выборке больше лимита: показаны первые `limit`. */
  truncated: boolean;
  /** Итоги по всему периоду — титул не зависит от среза страницы. */
  totals: PileJournalTotals;
}

export interface RawPileJournalTotals {
  piles: number;
  draftPiles: number;
  withoutPassportPiles: number;
  accepted: number;
  needsRedrive: number;
  pending: number;
  rows: number;
}

/**
 * Границы периода забивки в UTC — по календарным дням пояса тенанта.
 *
 * ПОЧЕМУ НЕ UTC-ПОЛНОЧЬ. Дата без времени означает «весь этот день» в поясе
 * организации — том же, в котором печатается день забивки (F-R17-1). Для МСК
 * окно дня сдвинуто на +3 ч: свая, забитая 26.09 в 00:30 МСК (25.09T21:30Z),
 * обязана быть в журнале «26.09», а не «25.09».
 *
 * ПОЧЕМУ ВЕРХНЯЯ ГРАНИЦА ИСКЛЮЧАЮЩАЯ. `lt` полуночи следующего дня не теряет
 * сваю, забитую 26.09 в 23:59, и не затягивает в выборку сваю 27.09 в 00:00.
 */
export function periodBounds(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  timezone: string,
): { gte?: Date; lt?: Date } | null {
  if (!dateFrom && !dateTo) return null;
  return {
    ...(dateFrom ? { gte: zonedDayStartUtc(dateFrom, timezone) } : {}),
    ...(dateTo ? { lt: zonedDayStartUtc(addDays(dateTo, 1), timezone) } : {}),
  };
}

/** Следующий календарный день ГГГГ-ММ-ДД. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
