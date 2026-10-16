/**
 * transliterate — ГОСТ 7.79 система Б для имени PDF в Telegram (F10 стенда 16.10).
 * Кириллица не должна превращаться в «_»: имя файла остаётся читаемым.
 */
import { describe, it, expect } from 'vitest';
import { transliterate } from '../transliterate';

describe('transliterate (ГОСТ 7.79, система Б)', () => {
  it('переводит пример из стенда: «ЛОАД 1» → «LOAD 1»', () => {
    expect(transliterate('ЛОАД 1')).toBe('LOAD 1');
  });

  it('сохраняет регистр и точки в ФИО', () => {
    expect(transliterate('Иванов И.И.')).toBe('Ivanov I.I.');
  });

  it('убирает диакритику: Щ → S, Ц → C, Ё → E', () => {
    expect(transliterate('Щ')).toBe('S');
    expect(transliterate('ц')).toBe('c');
    expect(transliterate('Ё')).toBe('E');
  });

  it('опускает Ъ и Ь, которые ГОСТ передаёт знаками ʺ и ʹ', () => {
    expect(transliterate('Объём')).toBe('Obem');
  });

  it('пустая строка и строка без кириллицы не меняются', () => {
    expect(transliterate('')).toBe('');
    expect(transliterate('abc-123_X.pdf')).toBe('abc-123_X.pdf');
  });

  it('спецсимволы вне кириллицы не трогает (очистка имени — на стороне вызова)', () => {
    expect(transliterate('Иван/№1 "а"')).toBe('Ivan/№1 "a"');
  });
});
