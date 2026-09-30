/**
 * Текст ошибки для машиниста (аудит R76, находка 5).
 *
 * Сетевой сбой в браузере — это `TypeError` с английской строкой («Failed to
 * fetch», «Load failed» в Safari). Раньше она уходила на экран как есть: в
 * русском интерфейсе машинист читал «Failed to fetch» и звонил диспетчеру про
 * поломку приложения вместо того, чтобы проверить связь.
 */
import {describe, expect, it, vi} from 'vitest';
import {ApiError, fetchKnowledgeAttempt, operatorErrorText, QueuedOffline} from '../api';
import {QueueStorageError} from '../offline-queue';

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

  // Ошибка хранилища — предупреждение о возможной потере данных, его нельзя
  // затирать общей фразой: «не закрывайте форму» и есть выход.
  it('недоступное хранилище объясняет, что запись не сохранится', () => {
    expect(operatorErrorText(new QueueStorageError('unavailable'))).toBe(
      'Память браузера недоступна (частный режим?) — без связи запись не сохранится. Не закрывайте форму и отправьте её при связи.',
    );
  });

  it('переполненное хранилище просит освободить место', () => {
    expect(operatorErrorText(new QueueStorageError('full'))).toBe(
      'Не удалось сохранить запись на устройстве. Не закрывайте форму: освободите место или восстановите связь и повторите.',
    );
  });

  it('запись в очереди — не отказ, а «сохранено на устройстве»', () => {
    expect(operatorErrorText(new QueuedOffline('Выработка')))
      .toBe('Выработка: сохранено на устройстве, отправим при связи');
    expect(operatorErrorText(new QueuedOffline('Выработка', 'после входа')))
      .toBe('Выработка: сохранено на устройстве, отправим после входа');
  });

  it('прочая ошибка — общий совет повторить', () => {
    expect(operatorErrorText(new Error('что-то не сошлось')))
      .toBe('Не удалось выполнить действие. Повторите.');
  });
});

/**
 * Загрузка вопросов проверки знаний (аудит R76, находка 16).
 *
 * Раньше экран разбирал ответ своим кодом: `response.json()` шёл до проверки
 * статуса, а текст брался как `error.message`. Ответ не-JSON (портал Wi‑Fi,
 * HTML-ошибка прокси) давал английское «Unexpected token '<'…».
 */
describe('fetchKnowledgeAttempt', () => {
  it('не-JSON ответ — русский текст про чужой сервер, а не английский разбор', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Вход в сеть</html>', {status: 200})));
    await expect(fetchKnowledgeAttempt()).rejects.toThrow(/не от сервера приложения/);
    vi.unstubAllGlobals();
  });

  it('HTML-ошибка прокси — отказ сервера с кодом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', {status: 502})));
    const error = await fetchKnowledgeAttempt().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect(operatorErrorText(error)).toBe('Сервер не ответил');
    vi.unstubAllGlobals();
  });

  it('успешный ответ — вопросы и токен попытки', async () => {
    const payload = {data: {questions: [{id: 'q-1', topic: 'GENERAL', text: 'Вопрос', options: ['а', 'б'], correct: 0}], attemptToken: 'token-1'}};
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {status: 200})));
    await expect(fetchKnowledgeAttempt()).resolves.toEqual(payload.data);
    vi.unstubAllGlobals();
  });

  it('200 с чужим JSON без наших полей — отказ, экран не зависает', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({status: 'ok'}), {status: 200})));
    await expect(fetchKnowledgeAttempt()).rejects.toThrow(/не от сервера приложения/);
    vi.unstubAllGlobals();
  });
});
