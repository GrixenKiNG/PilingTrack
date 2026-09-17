import type {DocumentCheck, DocumentVerdict} from '@/modules/operator-mobile/contracts';

/**
 * Сводка по документам работника — то, что видно, пока список свёрнут.
 *
 * ЗАЧЕМ. Одиннадцать раскрытых карточек «действует · до 14.09.2029» занимают
 * четыре экрана прокрутки и отвечают на вопрос, которого человек не задавал.
 * Вопрос у него один: «с моими корочками всё в порядке?» Ответ на него —
 * одна строка, а список нужен только тогда, когда ответ «нет» или когда
 * спросил диспетчер.
 *
 * Расчёт вынесен из разметки, потому что им пользуются все четыре модуля, а
 * правило «что считать плохим» должно быть одно: расхождение здесь означало бы,
 * что в двух сборках один и тот же набор документов оценён по-разному.
 */

export interface DocumentsSummary {
  total: number;
  /** Просроченные и незаведённые среди обязательных — то, что держит допуск. */
  blocking: number;
  /** Обязательные с истекающим сроком: ещё не держат, но уже пора шевелиться. */
  expiring: number;
  /** Худший вердикт по обязательным. `null` — обязательных нет вовсе. */
  worst: DocumentVerdict | null;
  /** Ближайший срок среди обязательных. `null` — сроков нет. */
  nearestExpiry: Date | null;
  /** Готовая строка для свёрнутой шапки. */
  note: string;
}

/** Чем хуже, тем больше число. Порядок — от «всё хорошо» к «держит допуск». */
const SEVERITY: Record<DocumentVerdict, number> = {
  VALID: 0, EXPIRING: 1, EXPIRED: 2, MISSING: 3,
};

export function documentsSummary(documents: DocumentCheck[]): DocumentsSummary {
  const required = documents.filter((document) => document.required);
  const blocking = required.filter(
    (document) => document.verdict === 'EXPIRED' || document.verdict === 'MISSING',
  );
  const expiring = required.filter((document) => document.verdict === 'EXPIRING');

  const worst = required.reduce<DocumentVerdict | null>((current, document) => (
    current === null || SEVERITY[document.verdict] > SEVERITY[current] ? document.verdict : current
  ), null);

  /* `expiresAt` объявлен как `Date`, но через JSON приходит строкой — разбираем
     оба вида, иначе ближайший срок всегда оказывался «не указан». */
  const nearestExpiry = required
    .map((document) => (document.expiresAt ? new Date(document.expiresAt as unknown as string) : null))
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

  return {
    total: documents.length,
    blocking: blocking.length,
    expiring: expiring.length,
    worst,
    nearestExpiry,
    note: note({count: documents.length, blocking: blocking.length, expiring: expiring.length, nearestExpiry}),
  };
}

function note(input: {
  count: number; blocking: number; expiring: number; nearestExpiry: Date | null;
}): string {
  if (input.count === 0) return 'виды документов не заведены';
  if (input.blocking > 0) return `требуют внимания: ${input.blocking}`;
  if (input.expiring > 0) return `истекают: ${input.expiring}`;
  return input.nearestExpiry
    ? `все действуют · ближайший срок ${input.nearestExpiry.toLocaleDateString('ru-RU')}`
    : 'все действуют';
}
