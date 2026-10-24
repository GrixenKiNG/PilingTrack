/** Один источник на установку за период; недостаточные данные никогда не равны нулю. */
export interface FuelConsumption {
  liters: number | null;
  source: 'telemetry' | 'manual' | 'none';
  quality: 'measured' | 'insufficient';
}

interface CounterReading { value: number; timestamp: Date }
export interface ManualFuelReading {
  recordedAt: Date;
  tankPercent: number | null;
  litersAdded: number | null;
}

/** Значения уже отсортированы по времени. Любое уменьшение означает неизвестный сброс. */
export function resolveFuelConsumption(
  telemetry: readonly CounterReading[], manualLiters: number | null, hasManual: boolean,
): FuelConsumption {
  const points = telemetry.filter((point, index) => index === 0 ||
    point.timestamp.getTime() !== telemetry[index - 1].timestamp.getTime() || point.value !== telemetry[index - 1].value);
  const valid = points.length >= 2 && points.every((point, index) =>
    Number.isFinite(point.value) && point.value >= 0 && (index === 0 ||
      (point.timestamp > points[index - 1].timestamp && point.value >= points[index - 1].value)));
  if (valid) return { liters: points[points.length - 1].value - points[0].value, source: 'telemetry', quality: 'measured' };
  if (manualLiters != null && Number.isFinite(manualLiters) && manualLiters >= 0) {
    return { liters: manualLiters, source: 'manual', quality: 'measured' };
  }
  return { liters: null, source: telemetry.length ? 'telemetry' : hasManual ? 'manual' : 'none', quality: 'insufficient' };
}

/** Записи упорядочены по recordedAt/createdAt/id. Первый остаток уже учитывает долив этой записи. */
export function summarizeManualFuel(
  tankLiters: number | null, entries: readonly ManualFuelReading[], before: ManualFuelReading | null,
) {
  const measured = entries.filter((entry) => entry.tankPercent != null);
  const start = before ?? measured[0] ?? null;
  const end = measured[measured.length - 1] ?? null;
  const litersAdded = entries.reduce((sum, entry) => sum + (entry.litersAdded ?? 0), 0);
  const startIndex = before ? -1 : start ? entries.indexOf(start) : entries.length;
  const endIndex = end ? entries.lastIndexOf(end) : -1;
  const additions = entries.slice(startIndex + 1, endIndex + 1)
    .reduce((sum, entry) => sum + (entry.litersAdded ?? 0), 0);
  const balance = tankLiters != null && tankLiters > 0 && start?.tankPercent != null && end?.tankPercent != null && end.recordedAt > start.recordedAt
    ? additions + tankLiters * (start.tankPercent - end.tankPercent) / 100 : null;
  return {
    liters: balance != null && Number.isFinite(balance) && balance >= 0 ? balance : null,
    litersAdded, startPercent: start?.tankPercent ?? null, endPercent: end?.tankPercent ?? null,
    entryCount: entries.length,
  };
}
