/**
 * Single source of truth for the length, in metres, of one pile of a given grade.
 *
 * Length used to be parsed from `PileGrade.name` with `name.match(/\d{3}/)/10` in
 * seven separate places that drifted apart (some used the site plan, some only the
 * name), so the same report could show different м.п. on the reports screen, the
 * dashboard and the PDF. All of those now call `pileLengthMeters` so the number is
 * computed in exactly one place.
 *
 * Length comes from the grade only. `SitePilePlan.metersPerUnit` is a *planning*
 * figure, not a length source (it held unreliable values, e.g. 123 m/pile), so it
 * is deliberately NOT consulted here — see docs/.../tenant-dictionaries.md Task 7'.
 *
 * Resolution order:
 *   1. grade-intrinsic length (`PileGrade.lengthMm`) when set
 *   2. 0 (unknown — never silently re-parse the display name)
 */
export interface PileLengthSource {
  /** Grade-intrinsic length in millimetres (PileGrade.lengthMm). */
  gradeLengthMm?: number | null;
}

export function pileLengthMeters({ gradeLengthMm }: PileLengthSource): number {
  if (gradeLengthMm && gradeLengthMm > 0) return gradeLengthMm / 1000;
  return 0;
}

/**
 * Parse a length (millimetres) out of a grade name. Used ONLY to seed
 * `PileGrade.lengthMm` once — on the backfill migration and when a new grade is
 * created — after which the stored value is authoritative and admin-editable.
 *
 * Mirrors the legacy regex exactly: the first 3-digit run is read as decimetres
 * ("С300" -> 300 dm -> 30.0 m -> 30000 mm). Returns null when nothing parseable,
 * so callers store null (= unknown length) rather than a silently-wrong 0.
 */
export function lengthMmFromGradeName(name: string): number | null {
  const m = name.match(/\d{3}/);
  return m ? Number(m[0]) * 100 : null;
}
