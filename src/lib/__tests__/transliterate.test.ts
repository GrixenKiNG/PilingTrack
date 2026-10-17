/**
 * transliterate — читаемая латиница для имени PDF в Telegram (F10 стенда 16.10).
 * Кириллица не должна превращаться в «_»: имя файла остаётся читаемым.
 */
import { describe, it, expect } from 'vitest';
import { transliterate } from '../transliterate';

describe('transliterate', () => {
  it('переводит пример из стенда: «ЛОАД 1» → «LOAD 1»', () => {
    expect(transliterate('ЛОАД 1')).toBe('LOAD 1');
  });

  it('сохраняет регистр и точки в ФИО', () => {
    expect(transliterate('Иванов И.И.')).toBe('Ivanov I.I.');
  });

  it('шипящие и йотированные — буквенными сочетаниями, без склейки', () => {
    expect(transliterate('Шишкин')).toBe('Shishkin');
    expect(transliterate('Чижов')).toBe('Chizhov');
    expect(transliterate('Щукин Цой Юрьев Яхин Хомяков')).toBe('Shchukin Tsoy Yurev Yakhin Khomyakov');
    expect(transliterate('Ёлкин')).toBe('Elkin');
  });

  it('опускает Ъ и Ь', () => {
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
