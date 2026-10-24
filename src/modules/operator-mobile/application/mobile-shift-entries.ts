import {pileLengthMeters} from '@/lib/pile-length';
import type { ProductionEntryView } from '../domain/view-contracts';

export const DAY_MS = 86_400_000;

export function todayInTimezone(timezone: string, now: Date): Date {
  // Производственные сутки считаем по часовому поясу пользователя, а не по UTC:
  // ночная смена в Сибири иначе уезжает во «вчера».
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/** Ненулевой простой без перерывов: перерыв — не потеря времени объекта. */
export const DOWNTIME_ONLY = {OR: [{kind: null}, {kind: {not: 'BREAK'}}]};

type ReportRows = {
  piles: {id: string; count: number; pileGradeId: string; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
  drillings: {id: string; count: number; meters: number; typeId: string; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
  downtimes: {id: string; duration: number; kind: string | null; reasonId: string | null; occurredAt: Date | null; correctsId: string | null; correctionNote: string | null}[];
} | null;

/**
 * Записи смены с итогом после поправок.
 *
 * Исходная строка и поправки к ней — разные строки в базе; экрану нужна одна
 * строка с итогом и видимым следом правок. Свернуть их молча нельзя: журнал
 * без следа правок ничем не отличается от журнала, который подчистили.
 */
export function buildEntries(
  report: ReportRows,
  dictionaries: {
    pileGrades: {id: string; name: string; lengthMm: number | null}[];
    drillingTypes: {id: string; name: string}[];
    downtimeReasons: {id: string; name: string}[];
  },
  gradeLength: Map<string, number | null>,
): ProductionEntryView[] {
  if (!report) return [];

  const gradeName = new Map(dictionaries.pileGrades.map((g) => [g.id, g.name]));
  const typeName = new Map(dictionaries.drillingTypes.map((t) => [t.id, t.name]));
  const reasonName = new Map(dictionaries.downtimeReasons.map((r) => [r.id, r.name]));
  const moment = (value: Date | null) => (value ?? new Date(0)).toISOString();

  const collect = <T extends {id: string; correctsId: string | null; correctionNote: string | null; occurredAt: Date | null}>(
    rows: T[],
    kind: ProductionEntryView['kind'],
    label: (row: T) => string,
    value: (row: T) => number,
    meters: (row: T) => number | null,
  ): ProductionEntryView[] => {
    const originals = rows.filter((row) => !row.correctsId);
    const byTarget = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.correctsId) continue;
      byTarget.set(row.correctsId, [...(byTarget.get(row.correctsId) ?? []), row]);
    }
    return originals.map((row) => {
      const patches = byTarget.get(row.id) ?? [];
      const total = value(row) + patches.reduce((sum, patch) => sum + value(patch), 0);
      const totalMeters = meters(row) === null ? null
        : (meters(row) ?? 0) + patches.reduce((sum, patch) => sum + (meters(patch) ?? 0), 0);
      return {
        id: row.id,
        kind,
        label: label(row),
        value: Math.round(total * 100) / 100,
        meters: totalMeters === null ? null : Math.round(totalMeters * 10) / 10,
        occurredAt: moment(row.occurredAt),
        corrections: patches
          .map((patch) => ({
            delta: Math.round(value(patch) * 100) / 100,
            note: patch.correctionNote ?? '',
            at: moment(patch.occurredAt),
          }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      };
    });
  };

  return [
    ...collect(
      report.piles, 'PILES',
      (row) => gradeName.get(row.pileGradeId) ?? 'Свая',
      (row) => row.count,
      (row) => row.count * pileLengthMeters({gradeLengthMm: gradeLength.get(row.pileGradeId) ?? null}),
    ),
    ...collect(
      report.drillings, 'DRILLING',
      (row) => typeName.get(row.typeId) ?? 'Бурение',
      (row) => row.count,
      (row) => row.meters,
    ),
    ...collect(
      report.downtimes.filter((row) => row.kind === 'DOWNTIME'), 'DOWNTIME',
      (row) => (row.reasonId ? reasonName.get(row.reasonId) ?? 'Простой' : 'Простой'),
      (row) => row.duration,
      () => null,
    ),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
