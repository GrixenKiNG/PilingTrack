/**
 * Что изменилось в машине за смену.
 *
 * Сравнивает ответы предсменного и послесменного осмотра одной смены. Это
 * единственное место, где система сама, без слов человека, говорит: машину
 * сдали не в том состоянии, в каком приняли.
 *
 * СОПОСТАВЛЕНИЕ ПО ТЕКСТУ, А НЕ ПО ИДЕНТИФИКАТОРУ ПУНКТА. Осмотр до работ и
 * осмотр после работ — разные шаблоны: первый полный, второй короткий, иначе
 * его никто не станет проходить в конце смены. Идентификаторы пунктов у них
 * разные, а формулировка «Течи гидравлического масла» — одна. Текст
 * нормализуется: регистр, пробелы и ё/е не должны мешать совпадению.
 *
 * Сравниваются только пункты, встречающиеся в обоих осмотрах. Пункт, которого
 * в послесменном нет, — не «стало лучше», а «не проверяли».
 */
export interface StateAnswer {
  /** Формулировка пункта из снимка шаблона. */
  text: string;
  /** Ответ: NORMAL | WARNING | FAIL | NA либо YES/NO/DONE. */
  result: string;
}

export interface StateChange {
  text: string;
  from: string;
  to: string;
  /** Стало хуже — именно это попадает в передачу смены. */
  worsened: boolean;
}

/**
 * Порядок «здоровья» ответа. Чем больше число, тем хуже состояние.
 * Неизвестный ответ считаем нейтральным: выдумывать ухудшение нельзя.
 */
const SEVERITY: Record<string, number> = {
  NA: 0, NOT_APPLICABLE: 0,
  YES: 1, NORMAL: 1, DONE: 1, OK: 1, PASS: 1,
  WARNING: 2, ATTENTION: 2,
  NO: 3, FAIL: 3, CRITICAL: 3,
};

const normalize = (text: string) =>
  text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

const severity = (result: string) => SEVERITY[result.trim().toUpperCase()] ?? null;

export function diffInspectionStates(
  before: readonly StateAnswer[],
  after: readonly StateAnswer[],
): StateChange[] {
  const beforeByText = new Map(before.map((answer) => [normalize(answer.text), answer]));
  const changes: StateChange[] = [];

  for (const post of after) {
    const pre = beforeByText.get(normalize(post.text));
    if (!pre) continue;
    if (pre.result.trim().toUpperCase() === post.result.trim().toUpperCase()) continue;

    const preLevel = severity(pre.result);
    const postLevel = severity(post.result);
    changes.push({
      text: post.text,
      from: pre.result,
      to: post.result,
      // Ухудшение утверждаем только когда обе оценки понятны. Иначе это просто
      // «ответ другой», и решать человеку.
      worsened: preLevel !== null && postLevel !== null && postLevel > preLevel,
    });
  }
  return changes;
}

/** Короткая строка для сводки передачи смены. */
export function describeStateChanges(changes: readonly StateChange[]): string {
  return changes
    .filter((change) => change.worsened)
    .map((change) => `${change.text}: ${change.from} → ${change.to}`)
    .join('; ');
}
