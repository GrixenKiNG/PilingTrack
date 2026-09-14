import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
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
  id: string;
  pileNumber: string;
  drivenAt: string;
  siteName: string;
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
  acceptance: PileAcceptanceValue;
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
  /** Поиск по номеру сваи. */
  pileNumber?: string;
  limit?: number;
}

/**
 * Конец дня по границе периода.
 *
 * Дата без времени означает «весь этот день»: `dateTo = 2026-09-14` обязан
 * включать сваю, забитую в 18:40. Сравнение с полуночью выкинуло бы весь
 * последний день выборки — и молча, что хуже всего.
 */
function endOfDay(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Date(parsed.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export async function listPilePassports(input: PileJournalFilters): Promise<PilePassportRow[]> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const acceptance = input.acceptance ?? (input.pendingOnly ? 'PENDING' : undefined);
  const rows = await db.pilePassport.findMany({
    where: {
      tenantId: input.tenantId,
      ...(acceptance ? { acceptance } : {}),
      ...(input.pileNumber
        ? { pileNumber: { contains: input.pileNumber, mode: 'insensitive' as const } }
        : {}),
      ...(input.dateFrom || input.dateTo
        ? {
          drivenAt: {
            ...(input.dateFrom ? { gte: new Date(`${input.dateFrom}T00:00:00.000Z`) } : {}),
            ...(input.dateTo ? { lte: endOfDay(input.dateTo) } : {}),
          },
        }
        : {}),
      ...(input.siteId ? { pileWork: { report: { siteId: input.siteId } } } : {}),
    },
    orderBy: { drivenAt: 'desc' },
    take: Math.min(input.limit ?? 100, 500),
    include: {
      sets: { orderBy: { ordinal: 'asc' } },
      pileWork: {
        select: {
          pileGrade: { select: { name: true, lengthMm: true, sectionOrDiameter: true } },
          picket: { select: { name: true, cluster: { select: { name: true } } } },
          report: {
            select: {
              site: { select: { name: true } },
              user: { select: { name: true } },
              equipment: { select: { name: true } },
              crew: { select: { equipment: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  // Кто принял сваю — одним запросом на всю страницу, а не по строке.
  const deciderIds = [...new Set(rows.map((row) => row.acceptedById).filter((id): id is string => !!id))];
  const deciders = deciderIds.length > 0
    ? await db.user.findMany({
      where: { tenantId: input.tenantId, id: { in: deciderIds } },
      select: { id: true, name: true },
    })
    : [];
  const deciderById = new Map(deciders.map((user) => [user.id, user.name]));

  return rows.map((row) => {
    const sets: DrivingSet[] = row.sets.map((set) => ({
      ordinal: set.ordinal,
      blows: set.blows,
      penetrationMm: set.penetrationMm,
      dropHeightM: set.dropHeightM,
    }));

    // Залоги — источник отказа. Их нет только у старых паспортов и у быстрой
    // записи одним замером: там считаем по паре refusalSet* в самом паспорте,
    // тем же правилом.
    const journal = journalRefusalMm(sets);
    const refusalMm = journal?.refusalMm ?? actualRefusalMm({
      penetrationMm: row.refusalSetPenetrationMm,
      blows: row.refusalSetBlows,
    });

    const picket = row.pileWork.picket;
    const report = row.pileWork.report;

    return {
      id: row.id,
      pileNumber: row.pileNumber,
      drivenAt: row.drivenAt.toISOString(),
      siteName: report?.site?.name ?? '—',
      locationName: picket
        ? `${picket.cluster?.name ? `${picket.cluster.name} · ` : ''}${picket.name}`
        : null,
      operatorName: report?.user?.name ?? '—',
      equipmentName: report?.equipment?.name ?? report?.crew?.equipment?.name ?? null,
      recordedByForeman: row.recordedByForeman,
      pileGradeName: row.pileWork.pileGrade?.name ?? '—',
      pileSection: row.pileWork.pileGrade?.sectionOrDiameter ?? null,
      pileLengthM: row.pileWork.pileGrade?.lengthMm != null
        ? row.pileWork.pileGrade.lengthMm / 1000
        : null,
      designHeadLevelM: row.designHeadLevelM,
      actualHeadLevelM: row.actualHeadLevelM,
      drivenDepthM: row.drivenDepthM,
      followerUsed: row.followerUsed,
      redriven: row.redriven,
      headCutOff: row.headCutOff,
      refusalSetPenetrationMm: row.refusalSetPenetrationMm,
      refusalSetBlows: row.refusalSetBlows,
      designRefusalMm: row.designRefusalMm,
      refusalMm,
      refusalSetsUsed: journal?.setsUsed ?? (refusalMm !== null ? 1 : 0),
      sets: row.sets.map((set) => ({
        ordinal: set.ordinal,
        blows: set.blows,
        penetrationMm: set.penetrationMm,
        dropHeightM: set.dropHeightM,
        refusalMm: setRefusalMm({ blows: set.blows, penetrationMm: set.penetrationMm }),
      })),
      drivingComplete: drivingComplete({ sets, designRefusalMm: row.designRefusalMm }),
      totalBlows: row.totalBlows,
      blowsLastMeter: row.blowsLastMeter,
      planDeviationMm: row.planDeviationMm,
      tiltPercent: row.tiltPercent,
      hammerType: row.hammerType,
      hammerEnergyKj: row.hammerEnergyKj,
      dropHeightM: row.dropHeightM,
      note: row.note,
      acceptance: row.acceptance as PileAcceptanceValue,
      acceptanceNote: row.acceptanceNote,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      acceptedByName: row.acceptedById ? deciderById.get(row.acceptedById) ?? null : null,
      redriveReadyAt: row.acceptance === 'NEEDS_REDRIVE' && row.acceptedAt
        ? redriveReadyAt(row.acceptedAt).toISOString()
        : null,
      suggestion: suggestAcceptance({ actualRefusalMm: refusalMm, designRefusalMm: row.designRefusalMm }),
    };
  });
}

/**
 * Титул журнала по уже загруженным строкам.
 *
 * ПОЧЕМУ ИЗ СТРОК, А НЕ ИЗ ОТДЕЛЬНЫХ ПОЛЕЙ ОБЪЕКТА. Копёр, молот, энергия
 * удара и проектный отказ записаны в каждом паспорте на момент забивки. Второй
 * источник тех же величин (карточка объекта) разошёлся бы с журналом на первой
 * же замене молота — и титул начал бы противоречить строкам под собой.
 */
export function pileJournalHeader(rows: PilePassportRow[]): PileJournalHeader {
  const uniq = <T,>(values: (T | null | undefined)[]): T[] =>
    [...new Set(values.filter((value): value is T => value !== null && value !== undefined))];

  const dates = rows.map((row) => row.drivenAt.slice(0, 10)).sort();

  return {
    siteNames: uniq(rows.map((row) => row.siteName)),
    equipmentNames: uniq(rows.map((row) => row.equipmentName)),
    hammerTypes: uniq(rows.map((row) => row.hammerType)),
    hammerEnergyKj: uniq(rows.map((row) => row.hammerEnergyKj)).sort((a, b) => a - b),
    designRefusalMm: uniq(rows.map((row) => row.designRefusalMm)).sort((a, b) => a - b),
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    pilesTotal: rows.length,
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
  const rows = await listPilePassports({ ...filters, limit: 500 });
  const header = pileJournalHeader(rows);

  const list = (values: (string | number)[]): string => (values.length ? values.join(', ') : '—');

  const title: (string | number | null)[][] = [
    ['ЖУРНАЛ ЗАБИВКИ СВАЙ'],
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
    ['Журнал выгружен', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ];

  const piles: (string | number | null)[][] = [[
    '№ п/п', 'Дата забивки', '№ сваи по проекту', 'Куст, пикет', 'Марка сваи', 'Сечение',
    'Длина, м', 'Отметка головы проектная, м', 'Отметка головы фактическая, м',
    'Глубина погружения, м', 'Залогов', 'Ударов всего', 'Ударов на последний метр',
    'Отказ проектный, мм/уд', 'Отказ фактический, мм/уд', 'Забита по норме',
    'Отклонение в плане, мм', 'Отклонение от вертикали, %',
    'Молот', 'Энергия удара, кДж', 'Высота подъёма, м',
    'Добивка', 'Добойник', 'Голова срублена',
    'Машинист', 'Установка', 'Решение', 'Принял', 'Дата решения', 'Основание решения', 'Примечание',
  ]];

  const setsSheet: (string | number | null)[][] = [[
    '№ сваи по проекту', 'Дата забивки', '№ залога', 'Ударов в залоге',
    'Погружение за залог, мм', 'Высота подъёма бойка, м', 'Отказ за залог, мм/уд',
  ]];

  const yesNo = (value: boolean): string => (value ? 'да' : 'нет');

  rows.forEach((row, index) => {
    piles.push([
      index + 1,
      row.drivenAt.slice(0, 10),
      row.pileNumber,
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
      ACCEPTANCE_TEXT[row.acceptance],
      row.acceptedByName ?? '',
      row.acceptedAt ? row.acceptedAt.slice(0, 10) : '',
      row.acceptanceNote ?? '',
      row.note ?? '',
    ]);

    for (const set of row.sets) {
      setsSheet.push([
        row.pileNumber,
        row.drivenAt.slice(0, 10),
        set.ordinal,
        set.blows,
        set.penetrationMm,
        set.dropHeightM,
        set.refusalMm,
      ]);
    }
  });

  return buildXlsx([
    { name: 'Титул', rows: title },
    { name: 'Журнал забивки', rows: piles },
    { name: 'Залоги', rows: setsSheet },
  ]);
}
