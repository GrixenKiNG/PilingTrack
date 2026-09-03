import { isNegativeAnswer } from './defect-rules';

export type AnswerType = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';

export interface SnapItem {
  id: string;
  answerType: AnswerType;
  required: boolean;
  photoRequired: boolean;
}
export interface AnswerLike {
  itemId: string;
  result: string;
  value?: string | null;
  photoCount: number;
}

const OK_RESULTS = new Set(['YES', 'OK', 'DONE']);
const NA_RESULTS = new Set(['NA']);

export function computeHealthScore(items: SnapItem[], answers: AnswerLike[]): number {
  const byId = new Map(answers.map((a) => [a.itemId, a]));
  let applicable = 0;
  let ok = 0;
  for (const it of items) {
    const a = byId.get(it.id);
    if (!a || a.result === '' || NA_RESULTS.has(a.result)) continue; // unanswered/NA excluded
    applicable += 1;
    if (OK_RESULTS.has(a.result)) ok += 1;
  }
  if (applicable === 0) return 0;
  return Math.round((ok / applicable) * 100);
}

/**
 * Чего не хватает, чтобы закрыть осмотр.
 *
 * Снимки возвращаются двумя списками, и это не удобство, а разница по
 * существу. `missingPhotos` — все пункты, у которых администратор потребовал
 * фото. `missingPhotosOnFault` — только те из них, где вдобавок отмечена
 * неисправность.
 *
 * ЗАЧЕМ РАЗДЕЛЕНИЕ. Снимок исправного узла ничего не доказывает и стоит
 * машинисту минуты в поле с рвущейся связью. Снимок трещины — это
 * единственное, по чему механик потом поймёт, что чинить. Требовать оба
 * одинаково значит либо потерять доказательство, либо получить смену,
 * которую не закрыть.
 */
export function findMissing(
  items: SnapItem[],
  answers: AnswerLike[],
): { missingAnswers: string[]; missingPhotos: string[]; missingPhotosOnFault: string[] } {
  const byId = new Map(answers.map((a) => [a.itemId, a]));
  const missingAnswers: string[] = [];
  const missingPhotos: string[] = [];
  const missingPhotosOnFault: string[] = [];
  for (const it of items) {
    const a = byId.get(it.id);
    const answered = !!a && a.result !== '';
    if (it.required && !answered) missingAnswers.push(it.id);
    if (it.photoRequired && (!a || a.photoCount < 1)) {
      missingPhotos.push(it.id);
      if (a && isNegativeAnswer(a.result)) missingPhotosOnFault.push(it.id);
    }
  }
  return { missingAnswers, missingPhotos, missingPhotosOnFault };
}
