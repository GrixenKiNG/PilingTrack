/**
 * Отказ формы должен называть поле, а не ограничиваться общим «Некорректные
 * данные»: маршруты отдают построчные ошибки двумя формами `details` — массивом
 * `{field, message}` (операторский upsert) и zod-`fieldErrors` (админский).
 */
import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '@/lib/api-error-message';

describe('apiErrorMessage — массив { field, message }', () => {
  it('добавляет построчные ошибки под общим текстом', () => {
    const body = {
      error: 'Некорректные данные',
      details: [
        { field: 'piles.2.count', message: 'Too small: expected number to be >0' },
        { field: 'date', message: 'Invalid input' },
      ],
    };

    expect(apiErrorMessage(body, 'Ошибка отправки отчёта')).toBe(
      'Некорректные данные\nСваи, строка 3: количество: Too small: expected number to be >0\nДата: некорректное значение',
    );
  });

  it('показывает не больше трёх полей', () => {
    const body = {
      error: 'Некорректные данные',
      details: [
        { field: 'a', message: '1' },
        { field: 'b', message: '2' },
        { field: 'c', message: '3' },
        { field: 'd', message: '4' },
      ],
    };

    expect(apiErrorMessage(body, 'Ошибка')).toBe('Некорректные данные\nПоле a: 1\nПоле b: 2\nПоле c: 3');
  });

  it('выводит сообщение без имени поля, если сервер его не указал', () => {
    expect(apiErrorMessage({ error: 'Некорректные данные', details: [{ message: 'Строка не заполнена' }] }, 'Ошибка'))
      .toBe('Некорректные данные\nСтрока не заполнена');
  });
});

describe('apiErrorMessage — zod fieldErrors', () => {
  it('разворачивает fieldErrors в строки «Поле <field>: <message>»', () => {
    const body = {
      error: 'Некорректные данные',
      details: { formErrors: [], fieldErrors: { count: ['Ожидалось число'], date: ['Неверная дата'] } },
    };

    expect(apiErrorMessage(body, 'Ошибка сохранения')).toBe(
      'Некорректные данные\nПоле count: Ожидалось число\nДата: Неверная дата',
    );
  });

  it('берёт первое непустое сообщение поля и пропускает пустые списки', () => {
    const body = { error: 'Некорректные данные', details: { fieldErrors: { count: ['', 'Второе'], empty: [] } } };

    expect(apiErrorMessage(body, 'Ошибка')).toBe('Некорректные данные\nПоле count: Второе');
  });
});

describe('apiErrorMessage — читаемые русские подписи', () => {
  it('переводит пути полей отчёта и английские тексты zod', () => {
    const body = {
      error: 'Некорректные данные',
      details: [
        { field: 'siteId', message: 'Required' },
        { field: 'date', message: 'Invalid input' },
        { field: 'shiftEnd', message: 'String must contain at least 1 character(s)' },
      ],
    };

    expect(apiErrorMessage(body, 'Ошибка')).toBe(
      'Некорректные данные\nОбъект: обязательное поле\nДата: некорректное значение\nКонец смены: не заполнено',
    );
  });

  it('нумерует строки разделов начиная с единицы', () => {
    const body = {
      error: 'Некорректные данные',
      details: {
        fieldErrors: {
          'piles.1.count': ['Number must be greater than or equal to 0'],
          'drillings.0.meters': ['Expected number, received string'],
          'downtimes.3.reasonId': ['Required'],
        },
      },
    };

    expect(apiErrorMessage(body, 'Ошибка')).toBe(
      'Некорректные данные\nСваи, строка 2: количество: должно быть не меньше 0\nБурение, строка 1: метры: ожидается число\nПростой, строка 4: причина: обязательное поле',
    );
  });

  it('оставляет незнакомый путь и незнакомый текст как есть', () => {
    const body = {
      error: 'Некорректные данные',
      details: [{ field: 'mlModel.weights', message: 'Something went wrong' }],
    };

    expect(apiErrorMessage(body, 'Ошибка')).toBe(
      'Некорректные данные\nПоле mlModel.weights: Something went wrong',
    );
  });
});

describe('apiErrorMessage — нет пригодных данных', () => {
  it('подставляет fallback на пустом теле', () => {
    expect(apiErrorMessage({}, 'Ошибка сохранения')).toBe('Ошибка сохранения');
    expect(apiErrorMessage({ error: 'Некорректные данные' }, 'Ошибка сохранения')).toBe('Некорректные данные');
  });

  it('подставляет fallback на теле не-объекте', () => {
    for (const body of [null, undefined, 'текст', 42]) {
      expect(apiErrorMessage(body, 'Ошибка сохранения')).toBe('Ошибка сохранения');
    }
  });

  it('подставляет fallback, если details неизвестной формы', () => {
    expect(apiErrorMessage({ error: '', details: 'строка' }, 'Ошибка сохранения')).toBe('Ошибка сохранения');
    expect(apiErrorMessage({ error: '', details: { formErrors: ['Что-то'] } }, 'Ошибка сохранения')).toBe('Ошибка сохранения');
  });
});
