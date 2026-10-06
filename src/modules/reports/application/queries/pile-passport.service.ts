import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { zonedDayStartUtc } from '@/lib/timezone';
import { pileLengthMeters } from '@/lib/pile-length';
import { isSubmittedReport } from '@/lib/report-status';
import { getSettings } from '@/modules/settings';
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
  pilesTotal: number;
  accepted: number;
  needsRedrive: number;
  pending: number;
  /** Свай, у которых отказ больше проектного. */
  overRefusal: number;
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
 * Предел строк журнала — один на экран и на выгрузку.
 *
 * ПОЧЕМУ ОДИН. Титул («Свай в журнале», «Принято», «На добивку») считается из
 * загруженных строк. Разные пределы на экране и в .xlsx дали бы подшитый
 * документ, противоречащий экрану, на котором его собирали.
 */
export const PILE_JOURNAL_LIMIT = 500;

export interface PileJournalPage {
  rows: PilePassportRow[];
  /** Строк в выборке больше лимита: показаны первые `PILE_JOURNAL_LIMIT`. */
  truncated: boolean;
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
function periodBounds(
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

export async function listPilePassports(input: PileJournalFilters): Promise<PileJournalPage> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const limit = Math.min(input.limit ?? PILE_JOURNAL_LIMIT, PILE_JOURNAL_LIMIT);
  const acceptance = input.acceptance ?? (input.pendingOnly ? 'PENDING' : undefined);
  // Пояс нужен только для периода: день фильтра — день тенанта, а не UTC.
  const bounds = input.dateFrom || input.dateTo
    ? periodBounds(
      input.dateFrom,
      input.dateTo,
      input.timezone ?? (await getSettings(input.tenantId)).timezone,
    )
    : null;
  // Строки журнала — записи выработки: одна строка PileWork (марка, количество,
  // смена, объект, кто записал, дата) = одна строка журнала. Паспорт подключаем
  // к строке по `pileWorkId` ради замеров и решения: сваи, записанные пачкой,
  // паспорта не имеют и всё равно обязаны быть в журнале.
  const rows = await db.pileWork.findMany({
    where: {
      // Организация — строгим равенством: чужой выработки журнал не показывает
      // (никаких `tenantId IS NULL OR ...` — это отдало бы строки всех тенантов).
      tenantId: input.tenantId,
      ...(input.siteId ? { report: { siteId: input.siteId } } : {}),
      // Решение и номер сваи живут в паспорте: фильтруем по нему, когда он
      // задан. Сваи без паспорта под эти фильтры не попадают — их нечего решать.
      ...(acceptance || input.pileNumber
        ? {
          passport: {
            ...(acceptance ? { acceptance } : {}),
            ...(input.pileNumber
              ? { pileNumber: { contains: input.pileNumber, mode: 'insensitive' as const } }
              : {}),
          },
        }
        : {}),
      // Дата забивки — момент работы, а не момент сохранения отчёта. Строку без
      // `occurredAt` ставим по `receivedAt`, иначе она выпала бы из любого периода.
      ...(bounds
        ? { OR: [{ occurredAt: bounds }, { occurredAt: null, receivedAt: bounds }] }
        : {}),
    },
    orderBy: [{ occurredAt: { sort: 'desc', nulls: 'last' } }, { receivedAt: 'desc' }],
    // Лишняя строка — только признак среза: в ответ уйдёт ровно `limit` строк.
    take: limit + 1,
    include: {
      pileGrade: { select: { name: true, lengthMm: true, sectionOrDiameter: true } },
      picket: { select: { name: true, cluster: { select: { name: true } } } },
      report: {
        select: {
          site: { select: { name: true } },
          user: { select: { name: true } },
          equipment: { select: { name: true } },
          crew: { select: { equipment: { select: { name: true } } } },
          shiftType: true,
          status: true,
        },
      },
      passport: { include: { sets: { orderBy: { ordinal: 'asc' } } } },
    },
  });

  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  // Кто принял сваю — одним запросом на всю страницу, а не по строке.
  const deciderIds = [...new Set(
    page.map((work) => work.passport?.acceptedById).filter((id): id is string => !!id),
  )];
  const deciders = deciderIds.length > 0
    ? await db.user.findMany({
      where: { tenantId: input.tenantId, id: { in: deciderIds } },
      select: { id: true, name: true },
    })
    : [];
  const deciderById = new Map(deciders.map((user) => [user.id, user.name]));

  const items = page.map((work) => {
    const passport = work.passport;
    const report = work.report;
    const picket = work.picket;

    // Замеры и решение живут в паспорте. У сваи, записанной пачкой, паспорта
    // нет — строка остаётся, а замеров и решения у неё не будет.
    const sets: DrivingSet[] = (passport?.sets ?? []).map((set) => ({
      ordinal: set.ordinal,
      blows: set.blows,
      penetrationMm: set.penetrationMm,
      dropHeightM: set.dropHeightM,
    }));

    // Залоги — источник отказа. Их нет только у старых паспортов и у быстрой
    // записи одним замером: там считаем по паре refusalSet* в самом паспорте,
    // тем же правилом.
    const journal = journalRefusalMm(sets);
    const refusalMm = passport
      ? journal?.refusalMm ?? actualRefusalMm({
        penetrationMm: passport.refusalSetPenetrationMm,
        blows: passport.refusalSetBlows,
      })
      : null;

    return {
      id: passport?.id ?? work.id,
      pileWorkId: work.id,
      passportId: passport?.id ?? null,
      hasPassport: passport !== null,
      isDraft: !isSubmittedReport(report),
      count: work.count,
      pileNumber: passport?.pileNumber ?? null,
      drivenAt: (work.occurredAt ?? work.receivedAt).toISOString(),
      siteName: report?.site?.name ?? '—',
      shiftType: report?.shiftType ?? null,
      locationName: picket
        ? `${picket.cluster?.name ? `${picket.cluster.name} · ` : ''}${picket.name}`
        : null,
      operatorName: report?.user?.name ?? '—',
      equipmentName: report?.equipment?.name ?? report?.crew?.equipment?.name ?? null,
      recordedByForeman: passport?.recordedByForeman ?? false,
      pileGradeName: work.pileGrade?.name ?? '—',
      pileSection: work.pileGrade?.sectionOrDiameter ?? null,
      pileLengthM: work.pileGrade?.lengthMm != null
        ? pileLengthMeters({ gradeLengthMm: work.pileGrade.lengthMm })
        : null,
      designHeadLevelM: passport?.designHeadLevelM ?? null,
      actualHeadLevelM: passport?.actualHeadLevelM ?? null,
      drivenDepthM: passport?.drivenDepthM ?? null,
      followerUsed: passport?.followerUsed ?? false,
      redriven: passport?.redriven ?? false,
      headCutOff: passport?.headCutOff ?? false,
      refusalSetPenetrationMm: passport?.refusalSetPenetrationMm ?? null,
      refusalSetBlows: passport?.refusalSetBlows ?? null,
      designRefusalMm: passport?.designRefusalMm ?? null,
      refusalMm,
      refusalSetsUsed: passport ? journal?.setsUsed ?? (refusalMm !== null ? 1 : 0) : 0,
      sets: sets.map((set) => ({
        ordinal: set.ordinal,
        blows: set.blows,
        penetrationMm: set.penetrationMm,
        dropHeightM: set.dropHeightM,
        refusalMm: setRefusalMm({ blows: set.blows, penetrationMm: set.penetrationMm }),
      })),
      drivingComplete: passport
        ? drivingComplete({ sets, designRefusalMm: passport.designRefusalMm })
        : null,
      totalBlows: passport?.totalBlows ?? null,
      blowsLastMeter: passport?.blowsLastMeter ?? null,
      planDeviationMm: passport?.planDeviationMm ?? null,
      tiltPercent: passport?.tiltPercent ?? null,
      hammerType: passport?.hammerType ?? null,
      hammerEnergyKj: passport?.hammerEnergyKj ?? null,
      dropHeightM: passport?.dropHeightM ?? null,
      note: passport?.note ?? null,
      acceptance: (passport?.acceptance as PileAcceptanceValue | undefined) ?? null,
      acceptanceNote: passport?.acceptanceNote ?? null,
      acceptedAt: passport?.acceptedAt?.toISOString() ?? null,
      acceptedByName: passport?.acceptedById ? deciderById.get(passport.acceptedById) ?? null : null,
      redriveReadyAt: passport?.acceptance === 'NEEDS_REDRIVE' && passport.acceptedAt
        ? redriveReadyAt(passport.acceptedAt).toISOString()
        : null,
      suggestion: passport
        ? suggestAcceptance({ actualRefusalMm: refusalMm, designRefusalMm: passport.designRefusalMm })
        : null,
    };
  });

  return { rows: items, truncated };
}

/**
 * Календарный день момента в поясе тенанта, ГГГГ-ММ-ДД — по нему сортируем
 * период забивки.
 *
 * ПОЧЕМУ НЕ UTC. `drivenAt` — момент времени: свая, забитая в 00:30 МСК 26.09,
 * в UTC ещё 25.09. День документа считается по поясу тенанта (F-R17-1).
 */
function dayInTimezone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}

/** День журнала в печатном виде — ДД.ММ.ГГГГ, как требует PRODUCT.md. */
function printDay(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: timezone,
  });
}

/** Момент времени в печатном виде — ДД.ММ.ГГГГ ЧЧ:ММ в поясе тенанта. */
function printMoment(date: Date, timezone: string): string {
  const time = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
  return `${printDay(date.toISOString(), timezone)} ${time}`;
}

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ. */
function printYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${day}.${month}.${year}`;
}

/**
 * Титул журнала по уже загруженным строкам.
 *
 * ПОЧЕМУ ИЗ СТРОК, А НЕ ИЗ ОТДЕЛЬНЫХ ПОЛЕЙ ОБЪЕКТА. Копёр, молот, энергия
 * удара и проектный отказ записаны в каждом паспорте на момент забивки. Второй
 * источник тех же величин (карточка объекта) разошёлся бы с журналом на первой
 * же замене молота — и титул начал бы противоречить строкам под собой.
 *
 * ПОЧЕМУ ПОЯС ВХОДИТ ПАРАМЕТРОМ. Его знает только выгрузка .xlsx: там день
 * печатается по поясу тенанта (F-R17-1). Без пояса период остаётся прежним —
 * UTC-днём, каким его получает экран.
 */
export function pileJournalHeader(rows: PilePassportRow[], timezone?: string): PileJournalHeader {
  const uniq = <T,>(values: (T | null | undefined)[]): T[] =>
    [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];

  const dates = rows
    .map((row) => (timezone ? dayInTimezone(row.drivenAt, timezone) : row.drivenAt.slice(0, 10)))
    .sort();
  const periodEdge = (day: string | undefined): string | null => {
    if (day === undefined) return null;
    return timezone ? printYmd(day) : day;
  };

  return {
    siteNames: uniq(rows.map((row) => row.siteName)),
    equipmentNames: uniq(rows.map((row) => row.equipmentName)),
    hammerTypes: uniq(rows.map((row) => row.hammerType)),
    hammerEnergyKj: uniq(rows.map((row) => row.hammerEnergyKj)).sort((a, b) => a - b),
    designRefusalMm: uniq(rows.map((row) => row.designRefusalMm)).sort((a, b) => a - b),
    dateFrom: periodEdge(dates[0]),
    dateTo: periodEdge(dates[dates.length - 1]),
    // «Свай в журнале» — число свай, а не строк: запись пачкой приносит сразу
    // несколько, а поправка с отрицательным счётом вычитается, как и в учёте.
    pilesTotal: rows.reduce((sum, row) => sum + row.count, 0),
    accepted: rows.filter((row) => row.acceptance === 'ACCEPTED').length,
    needsRedrive: rows.filter((row) => row.acceptance === 'NEEDS_REDRIVE').length,
    pending: rows.filter((row) => row.acceptance === 'PENDING').length,
    overRefusal: rows.filter((row) => row.suggestion?.value === 'NEEDS_REDRIVE').length,
  };
}

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

const ACCEPTANCE_TEXT: Record<PileAcceptanceValue, string> = {
  PENDING: 'Не разобрана',
  ACCEPTED: 'Принята',
  NEEDS_REDRIVE: 'На добивку',
};

/** Смена в печатном виде. Пустое/чужое значение печатаем как есть, не выдаём за дневную. */
const SHIFT_TEXT: Record<string, string> = {
  DAY: 'Дневная',
  NIGHT: 'Ночная',
};

function shiftText(shiftType: string | null): string {
  if (!shiftType) return '';
  return SHIFT_TEXT[shiftType] ?? shiftType;
}

/**
 * Журнал забивки в .xlsx — тот лист, который распечатывают и подшивают.
 *
 * ПОЧЕМУ ДВА ЛИСТА. Нормативная форма и есть два листа: титул (копёр, молот,
 * энергия удара, проектные величины, период) и строки по сваям. Свалить титул
 * в шапку таблицы значило бы повторять его в каждой строке.
 *
 * ПОЧЕМУ ЗАЛОГИ ОТДЕЛЬНЫМ ЛИСТОМ. «Погружение сваи от каждого залога» —
 * обязательная графа, и у одной сваи залогов десяток. В строке сваи они
 * помещаются только текстом, который в Excel нечем считать.
 */
export async function exportPileJournalXlsx(filters: PileJournalFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  // День документа — день тенанта, а не UTC (F-R17-1): свая, забитая в 00:30
  // МСК, в UTC ещё вчерашняя, и подшитый журнал датировал бы её соседним днём.
  const { timezone, companyName, inn } = await getSettings(filters.tenantId);
  const { rows, truncated } = await listPilePassports({ ...filters, limit: PILE_JOURNAL_LIMIT, timezone });
  const header = pileJournalHeader(rows, timezone);

  const list = (values: (string | number)[]): string => (values.length ? values.join(', ') : '—');

  // Исполнителя работ печатает нормативный журнал (СП 45.13330): подшитый
  // документ без организации не привязать к подрядчику. Пустые части не
  // печатаем — строка «Организация: , ИНН» хуже отсутствия строки.
  const organisation = [
    companyName ? `Организация: ${companyName}` : null,
    inn ? `ИНН ${inn}` : null,
  ].filter((part): part is string => part !== null).join(', ');

  const title: (string | number | null)[][] = [
    ['ЖУРНАЛ ЗАБИВКИ СВАЙ'],
    ...(organisation ? [[organisation]] : []),
    ['Объект', list(header.siteNames)],
    ['Копровая установка', list(header.equipmentNames)],
    ['Молот', list(header.hammerTypes)],
    ['Энергия удара, кДж', list(header.hammerEnergyKj)],
    ['Проектный отказ, мм/удар', list(header.designRefusalMm)],
    ['Период забивки', `${header.dateFrom ?? '—'} — ${header.dateTo ?? '—'}`],
    [],
    ['Свай в журнале', header.pilesTotal],
    ['Принято', header.accepted],
    ['На добивку', header.needsRedrive],
    ['Не разобрано', header.pending],
    ['Отказ больше проектного', header.overRefusal],
    [],
    ['Отказ считается как среднее по трём последним залогам (СП 45.13330).'],
    // Дата формирования — по поясу тенанта, как и весь остальной документ (F-R37-1):
    // журнал, выгруженный 26.09 в 01:00 МСК, не должен датироваться 25.09 по UTC.
    ['Журнал выгружен', printMoment(new Date(), timezone)],
    // Не молчим о срезе: иначе подшитый документ выглядел бы как полный.
    ...(truncated ? [[`Показаны первые ${PILE_JOURNAL_LIMIT} свай — сузьте период или объект`]] : []),
  ];

  const piles: (string | number | null)[][] = [[
    '№ п/п', 'Дата забивки', 'Смена', '№ сваи по проекту', 'Куст, пикет', 'Марка сваи', 'Сечение',
    'Длина, м', 'Отметка головы проектная, м', 'Отметка головы фактическая, м',
    'Глубина погружения, м', 'Залогов', 'Ударов всего', 'Ударов на последний метр',
    'Отказ проектный, мм/уд', 'Отказ фактический, мм/уд', 'Забита по норме',
    'Отклонение в плане, мм', 'Отклонение от вертикали, %',
    'Молот', 'Энергия удара, кДж', 'Высота подъёма, м',
    'Добивка', 'Добойник', 'Голова срублена',
    'Машинист', 'Установка', 'Решение', 'Принял', 'Дата решения', 'Основание решения', 'Примечание',
    'Количество, шт', 'Пометка',
  ]];

  const setsSheet: (string | number | null)[][] = [[
    '№ сваи по проекту', 'Дата забивки', '№ залога', 'Ударов в залоге',
    'Погружение за залог, мм', 'Высота подъёма бойка, м', 'Отказ за залог, мм/уд',
  ]];

  const yesNo = (value: boolean): string => (value ? 'да' : 'нет');

  // Та же пометка, что и на экране: свая без паспорта и черновик отчёта.
  // Подшитый документ не должен выглядеть полнее экрана, на котором его собрали.
  const marks = (row: PilePassportRow): string => [
    row.hasPassport ? null : 'без паспорта',
    row.isDraft ? 'черновик' : null,
  ].filter((part): part is string => part !== null).join(', ');

  rows.forEach((row, index) => {
    piles.push([
      index + 1,
      printDay(row.drivenAt, timezone),
      shiftText(row.shiftType),
      row.pileNumber ?? '',
      row.locationName ?? '',
      row.pileGradeName,
      row.pileSection ?? '',
      row.pileLengthM,
      row.designHeadLevelM,
      row.actualHeadLevelM,
      row.drivenDepthM,
      row.sets.length || null,
      row.totalBlows,
      row.blowsLastMeter,
      row.designRefusalMm,
      row.refusalMm,
      row.drivingComplete === null ? '—' : yesNo(row.drivingComplete),
      row.planDeviationMm,
      row.tiltPercent,
      row.hammerType ?? '',
      row.hammerEnergyKj,
      row.dropHeightM,
      yesNo(row.redriven),
      yesNo(row.followerUsed),
      yesNo(row.headCutOff),
      row.operatorName,
      row.equipmentName ?? '',
      row.acceptance ? ACCEPTANCE_TEXT[row.acceptance] : '',
      row.acceptedByName ?? '',
      row.acceptedAt ? printDay(row.acceptedAt, timezone) : '',
      row.acceptanceNote ?? '',
      row.note ?? '',
      row.count,
      marks(row),
    ]);

    for (const set of row.sets) {
      setsSheet.push([
        row.pileNumber ?? '',
        printDay(row.drivenAt, timezone),
        set.ordinal,
        set.blows,
        set.penetrationMm,
        set.dropHeightM,
        set.refusalMm,
      ]);
    }
  });

  // Дата составления и подписи — обязательные реквизиты нормативного журнала
  // (СП 45.13330): без них распечатку не подписать и не подшить.
  piles.push([]);
  piles.push([`Дата составления: ${printDay(new Date().toISOString(), timezone)}`]);
  piles.push(['Производитель работ ____________ / ФИО /']);
  piles.push(['Представитель технического надзора ____________ / ФИО /']);

  return buildXlsx([
    { name: 'Титул', rows: title },
    { name: 'Журнал забивки', rows: piles },
    { name: 'Залоги', rows: setsSheet },
  ]);
}
