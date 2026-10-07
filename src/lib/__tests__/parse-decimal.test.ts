import { describe, it, expect } from 'vitest';
import { parseDecimalInput } from '@/lib/parse-decimal';

describe('parseDecimalInput', () => {
  it('принимает запятую как разделитель дробной части', () => {
    expect(parseDecimalInput('1,5')).toBe(1.5);
    expect(parseDecimalInput('0,25')).toBe(0.25);
    expect(parseDecimalInput('-12,3')).toBe(-12.3);
  });

  // W62 №3: длина марки ровно 1000,00 м засевается в панель сведений значением
  // «1 000,00» (вёрстка ru-RU с пробелом-разделителем тысяч) — оно обязано
  // читаться, иначе любое сохранение панели отбивалось тостом (W64B).
  it('«1 000,00» и «1000,5» читаются как числа', () => {
    expect(parseDecimalInput('1 000,00')).toBe(1000);
    expect(parseDecimalInput('1000,5')).toBe(1000.5);
  });

  it('принимает точку', () => {
    expect(parseDecimalInput('1.5')).toBe(1.5);
    expect(parseDecimalInput('-12.3')).toBe(-12.3);
    expect(parseDecimalInput('.5')).toBe(0.5);
  });

  it('обрезает пробелы по краям', () => {
    expect(parseDecimalInput(' 2 ')).toBe(2);
    expect(parseDecimalInput('  35,00  ')).toBe(35);
  });

  it('принимает пробел-разделитель тысяч (значение из toLocaleString ru-RU)', () => {
    // Неразрывный пробел U+00A0 — именно его ставит toLocaleString('ru-RU').
    expect(parseDecimalInput('1 200,5')).toBe(1200.5);
    expect(parseDecimalInput('1\u00a0000,00')).toBe(1000);
    expect(parseDecimalInput('\u202f7\u202f500,25')).toBe(7500.25);
  });

  it('целое читается как целое', () => {
    expect(parseDecimalInput('1500')).toBe(1500);
    expect(parseDecimalInput('0')).toBe(0);
  });

  it('пустая строка и одни пробелы — null', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('   ')).toBeNull();
    expect(parseDecimalInput('\u00a0')).toBeNull();
  });

  it('мусор — null, а не NaN', () => {
    expect(parseDecimalInput('abc')).toBeNull();
    expect(parseDecimalInput('1,2,3')).toBeNull();
    expect(parseDecimalInput('1.2.3')).toBeNull();
    expect(parseDecimalInput('12л')).toBeNull();
    expect(parseDecimalInput('1,5м')).toBeNull();
    expect(parseDecimalInput(',')).toBeNull();
    expect(parseDecimalInput('-')).toBeNull();
    expect(parseDecimalInput('+')).toBeNull();
  });

  it('не пропускает бесконечность', () => {
    expect(parseDecimalInput('Infinity')).toBeNull();
    expect(parseDecimalInput('-Infinity')).toBeNull();
    expect(parseDecimalInput('1e999')).toBeNull();
  });
});
