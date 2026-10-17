/**
 * Кириллица → читаемая латиница (без внешних библиотек), по образцу
 * загранпаспорта: ж → zh, ч → ch, ш → sh, щ → shch, ю → yu, я → ya.
 *
 * Нужна имени PDF в Telegram: раньше кириллица там заменялась на «_»
 * (`report-…-LOAD__________1.pdf`, F10 стенда 16.10). Схема с диакритикой
 * (ГОСТ 7.79, система А) после очистки до ASCII склеивала буквы:
 * «Шишкин» → «Siskin», поэтому только буквенные сочетания. Ъ и Ь опускаем.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterateChar(char: string): string {
  const latin = CYRILLIC_TO_LATIN[char.toLowerCase()];
  if (latin === undefined) return char;
  // Заглавная буква даёт заглавную латиницу: «Л» → «L», «Ш» → «Sh».
  return char !== char.toLowerCase() ? latin.charAt(0).toUpperCase() + latin.slice(1) : latin;
}

export function transliterate(text: string): string {
  return Array.from(text, transliterateChar).join('');
}
