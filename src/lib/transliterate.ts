/**
 * Кириллица → латиница по ГОСТ 7.79-2000, система Б (без внешних библиотек).
 *
 * Нужна имени PDF в Telegram: раньше кириллица там заменялась на «_»
 * (`report-…-LOAD__________1.pdf`, F10 стенда 16.10). Система Б записывается
 * ASCII-буквами и буквенными сочетаниями (ж → zh, ш → sh, щ → shh, ю → yu),
 * поэтому имя остаётся читаемым и не требует очистки диакритики. Ъ и Ь ГОСТ
 * передаёт знаками ʺ и ʹ — в имени файла они лишние, поэтому опускаем.
 */
const GOST_779_B: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'j',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterateChar(char: string): string {
  const latin = GOST_779_B[char.toLowerCase()];
  if (latin === undefined) return char;
  // Заглавная буква даёт заглавную латиницу: «Л» → «L», «Ш» → «Sh».
  return char !== char.toLowerCase() ? latin.charAt(0).toUpperCase() + latin.slice(1) : latin;
}

export function transliterate(text: string): string {
  return Array.from(text, transliterateChar).join('');
}
