/**
 * Какие дефекты заводит завершённый осмотр.
 *
 * До этого связь «осмотр → дефект» существовала только в голове механика:
 * ответ «нет» на «есть ли течь гидравлики» снижал балл осмотра, и на этом всё
 * заканчивалось. Дефект — отдельная сущность с жизненным циклом и с
 * блокирующим правилом допуска, но завести его из осмотра было нечем, поэтому
 * часть логики допуска жила вне системы.
 *
 * Функция чистая: принимает снимок шаблона и ответы, возвращает список
 * дефектов к заведению. Побочные эффекты — в команде.
 */

export type DefectSeverity = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface DefectRuleItem {
  id: string;
  text: string;
  sectionTitle?: string;
  createsDefect?: boolean;
  defectSeverity?: string | null;
}

export interface DefectRuleAnswer {
  itemId: string;
  result: string;
  note?: string | null;
}

export interface PlannedDefect {
  itemId: string;
  title: string;
  node: string | null;
  severity: DefectSeverity;
  description: string;
}

/**
 * Ответы, которые считаются отрицательными.
 *
 * `NA` сюда не входит: «неприменимо» — это не неисправность. Пустой ответ тоже
 * не считается, до завершения осмотра его всё равно не пропустит проверка
 * заполненности.
 */
const NEGATIVE_RESULTS = new Set(['NO', 'FAIL', 'BAD', 'NOT_OK']);

const SEVERITIES = new Set<DefectSeverity>(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

function normalizeSeverity(value: string | null | undefined): DefectSeverity {
  return value && SEVERITIES.has(value as DefectSeverity) ? (value as DefectSeverity) : 'NORMAL';
}

export function isNegativeAnswer(result: string): boolean {
  return NEGATIVE_RESULTS.has(result.trim().toUpperCase());
}

export function planDefectsFromInspection(input: {
  items: readonly DefectRuleItem[];
  answers: readonly DefectRuleAnswer[];
}): PlannedDefect[] {
  const answerByItem = new Map(input.answers.map((answer) => [answer.itemId, answer]));
  const planned: PlannedDefect[] = [];
  for (const item of input.items) {
    if (!item.createsDefect) continue;
    const answer = answerByItem.get(item.id);
    if (!answer || !isNegativeAnswer(answer.result)) continue;
    planned.push({
      itemId: item.id,
      title: item.text.trim().slice(0, 200),
      node: item.sectionTitle?.trim() || null,
      severity: normalizeSeverity(item.defectSeverity),
      description: answer.note?.trim()
        ? `Отмечено при осмотре: ${answer.note.trim()}`.slice(0, 4000)
        : 'Зафиксировано отрицательным ответом в чек-листе осмотра.',
    });
  }
  return planned;
}

/**
 * Ключ, по которому дефект от осмотра считается тем же самым.
 *
 * Без него каждый сменный осмотр заводил бы новую запись на ту же
 * неисправность, и журнал дефектов утонул бы за неделю: одна незакрытая течь
 * дала бы тридцать строк за месяц. Пока прежний дефект по тому же пункту
 * открыт, новый не заводится.
 */
export function inspectionDefectKey(equipmentId: string, itemId: string): string {
  return `inspection-item:${equipmentId}:${itemId}`;
}
