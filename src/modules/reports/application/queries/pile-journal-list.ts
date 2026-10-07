import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { pileLengthMeters } from '@/lib/pile-length';
import { isSubmittedReport } from '@/lib/report-status';
import { getSettings } from '@/modules/settings';
import {
  PILE_JOURNAL_EXPORT_LIMIT,
  PILE_JOURNAL_LIMIT,
  actualRefusalMm,
  drivingComplete,
  journalRefusalMm,
  periodBounds,
  redriveReadyAt,
  setRefusalMm,
  suggestAcceptance,
  type DrivingSet,
  type PileAcceptanceValue,
  type PileJournalFilters,
  type PileJournalPage,
} from './pile-journal-types';
import { escapeLikePattern, pileJournalTotals } from './pile-journal-totals';

/**
 * Список журнала забивки: строки из записей выработки (PileWork), а не из одних
 * паспортов (W14). Сваи, записанные «пачкой» (count > 1, без паспорта), обязаны
 * быть видны — иначе журнал теряет почти всю фактическую забивку. Паспорт
 * подключается к строке по `pileWorkId` только ради замеров и решения.
 */
export async function listPilePassports(input: PileJournalFilters): Promise<PileJournalPage> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  // Экран просит 500 строк, выгрузка — свой, высокий предел.
  const limit = Math.min(input.limit ?? PILE_JOURNAL_LIMIT, PILE_JOURNAL_EXPORT_LIMIT);
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
              ? { pileNumber: { contains: escapeLikePattern(input.pileNumber), mode: 'insensitive' as const } }
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

  // Итоги периода — отдельным агрегатом по ВСЕЙ выборке; титул не срезается
  // вместе со страницей, иначе подшитый документ занижал бы числа.
  const totals = await pileJournalTotals(input, acceptance, bounds);

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

  return { rows: items, truncated, totals };
}
