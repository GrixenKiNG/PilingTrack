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

export function findMissing(
  items: SnapItem[],
  answers: AnswerLike[],
): { missingAnswers: string[]; missingPhotos: string[] } {
  const byId = new Map(answers.map((a) => [a.itemId, a]));
  const missingAnswers: string[] = [];
  const missingPhotos: string[] = [];
  for (const it of items) {
    const a = byId.get(it.id);
    const answered = !!a && a.result !== '';
    if (it.required && !answered) missingAnswers.push(it.id);
    if (it.photoRequired && (!a || a.photoCount < 1)) missingPhotos.push(it.id);
  }
  return { missingAnswers, missingPhotos };
}
