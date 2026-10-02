/**
 * R102 (важно №4–№6, №10): разбор отказа сервера на экране бригад.
 *
 * Обрыв связи приходил браузерным «Failed to fetch», истёкшая сессия —
 * английским «Unauthorized», CSRF-403 — технической строкой, а построчные
 * `details` 400-ответа отбрасывались. Здесь — чистая функция экрана.
 */
import { describe, expect, it } from 'vitest';
import { catchText, extractApiError, NETWORK_ERROR } from '../crew-messages';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('extractApiError', () => {
  it('401 → русский текст про сессию, а не «Unauthorized»', async () => {
    await expect(extractApiError(json({ error: 'Unauthorized' }, 401), 'Ошибка'))
      .resolves.toBe('Сессия истекла — войдите снова.');
  });

  it('CSRF-403 → русский текст про проверку безопасности', async () => {
    await expect(extractApiError(json({ error: 'CSRF validation failed: origin mismatch' }, 403), 'Ошибка'))
      .resolves.toBe('Запрос отклонён проверкой безопасности. Обновите страницу и повторите.');
  });

  it('обычный 403 отдаёт серверный текст как есть', async () => {
    await expect(extractApiError(json({ error: 'Доступ запрещён' }, 403), 'Ошибка'))
      .resolves.toBe('Доступ запрещён');
  });

  it('409 (установка занята) отдаёт серверный текст', async () => {
    await expect(extractApiError(json({ error: 'Установка уже закреплена за активной бригадой «X»' }, 409), 'Ошибка'))
      .resolves.toBe('Установка уже закреплена за активной бригадой «X»');
  });

  it('400 с построчными details показывает причину поля, а не только «Некорректные данные»', async () => {
    const res = json({ error: 'Некорректные данные', details: [{ field: 'name', message: 'Required' }] }, 400);
    const message = await extractApiError(res, 'Ошибка');
    expect(message).toContain('Некорректные данные');
    expect(message).toContain('Поле name: обязательное поле');
  });

  it('нечитаемое тело (HTML от прокси) → фолбэк, не исключение', async () => {
    const res = new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await expect(extractApiError(res, 'Не удалось сохранить')).resolves.toBe('Не удалось сохранить');
  });
});

describe('catchText', () => {
  it('обрыв сети (TypeError) → русский текст, а не «Failed to fetch»', () => {
    expect(catchText(new TypeError('Failed to fetch'), 'Ошибка')).toBe(NETWORK_ERROR);
  });

  it('обычная ошибка отдаёт своё сообщение', () => {
    expect(catchText(new Error('Бригада уже деактивирована'), 'Ошибка')).toBe('Бригада уже деактивирована');
  });

  it('не-Error → фолбэк', () => {
    expect(catchText('странность', 'Ошибка')).toBe('Ошибка');
  });
});
