/**
 * Текст ошибки для машиниста (аудит R76, находка 5).
 *
 * Сетевой сбой в браузере — это `TypeError` с английской строкой («Failed to
 * fetch», «Load failed» в Safari). Раньше она уходила на экран как есть: в
 * русском интерфейсе машинист читал «Failed to fetch» и звонил диспетчеру про
 * поломку приложения вместо того, чтобы проверить связь.
 */
import {describe, expect, it} from 'vitest';
import {ApiError, operatorErrorText} from '../api';

describe('operatorErrorText', () => {
  it('сетевой сбой — «Нет связи с сервером…», а не английская строка браузера', () => {
    expect(operatorErrorText(new TypeError('Failed to fetch')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
    expect(operatorErrorText(new TypeError('NetworkError when attempting to fetch resource')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
    expect(operatorErrorText(new TypeError('Load failed')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
  });

  it('отказ сервера доносит свой русский текст', () => {
    expect(operatorErrorText(new ApiError(400, 'Смена закрыта'))).toBe('Смена закрыта');
  });

  it('прочая ошибка — общий совет повторить', () => {
    expect(operatorErrorText(new Error('что-то не сошлось')))
      .toBe('Не удалось выполнить действие. Повторите.');
  });
});
