import { ServiceError } from '@/lib/service-error';

type Entry = {
  id?: string; pileGradeId?: string; count?: number; picketId?: string | null;
  typeId?: string; metersPerUnit?: number; meters?: number;
  reasonId?: string | null; duration?: number; comment?: string | null;
};
const value = (entry: Entry, key: string): unknown => (entry as Record<string, unknown>)[key];
type StoredEntry = Entry & { id: string; passport?: unknown };

/** Match legacy payloads without losing the identity of unchanged work. */
export function reconcileReportEntries(
  stored: StoredEntry[], incoming: Entry[], fields: string[], groupFields: string[],
) {
  const unused = new Map(stored.map((row) => [row.id, row]));
  const matches = new Map<number, StoredEntry>();
  const equal = (a: Entry, b: Entry, keys: string[]) => keys.every((key) =>
    (value(a, key) ?? null) === (value(b, key) ?? null));
  // Reserve explicit IDs first, so an old client cannot consume another row.
  incoming.forEach((row, index) => {
    if (!row.id) return;
    const previous = unused.get(row.id);
    if (!previous) throw new ServiceError('Строка отчёта отсутствует или указана повторно. Обновите отчёт.', 409);
    matches.set(index, previous);
    unused.delete(row.id);
  });
  // Exact matches come before changed rows (including duplicate grades).
  for (const keys of [fields, groupFields]) {
    incoming.forEach((row, index) => {
      if (matches.has(index)) return;
      const previous = [...unused.values()].find((candidate) =>
        (!candidate.passport || equal(candidate, row, fields)) && equal(candidate, row, keys));
      if (previous) {
        matches.set(index, previous);
        unused.delete(previous.id);
      }
    });
  }
  for (const [index, previous] of matches) {
    if (previous.passport && !equal(previous, incoming[index], fields)) {
      throw new ServiceError('Свая имеет паспорт. Изменяйте её через журнал свай, сохраняя исполнительные данные.', 409);
    }
  }
  if ([...unused.values()].some((row) => row.passport)) {
    throw new ServiceError('Нельзя удалить из отчёта сваю с паспортом. Откройте журнал свай.', 409);
  }
  return {
    removeIds: [...unused.keys()],
    rows: incoming.map((row, index) => ({
      id: matches.get(index)?.id,
      data: Object.fromEntries(fields.map((key) => [key, value(row, key) ?? null])),
    })),
  };
}
