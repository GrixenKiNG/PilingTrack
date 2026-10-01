/**
 * Текст ошибки для машиниста (аудит R76, находка 5).
 *
 * Сетевой сбой в браузере — это `TypeError` с английской строкой («Failed to
 * fetch», «Load failed» в Safari). Раньше она уходила на экран как есть: в
 * русском интерфейсе машинист читал «Failed to fetch» и звонил диспетчеру про
 * поломку приложения вместо того, чтобы проверить связь.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, fetchKnowledgeAttempt, operatorErrorDetails, operatorErrorText, QueuedOffline, sendCommand} from '../api';
import {QueueStorageError, readQueue} from '../offline-queue';

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

  // Отложение по истёкшему входу и по обрыву связи — разные поводы (R76,
  // находка 8): у первого есть выход «войти снова», у второго — только ждать.
  // По строке сообщения их не различить, поэтому у ошибки есть `reason`.
  it('отложение после входа помечено как auth, обрыв связи — как network', () => {
    expect(new QueuedOffline('Выработка', 'после входа').reason).toBe('auth');
    expect(new QueuedOffline('Выработка').reason).toBe('network');
    expect(new QueuedOffline('Выработка', 'при связи').reason).toBe('network');
  });

  it('прочая ошибка — общий совет повторить', () => {
    expect(operatorErrorText(new Error('что-то не сошлось')))
      .toBe('Не удалось выполнить действие. Повторите.');
  });
});

/**
 * Подробности отказа (аудит R76, находка 10).
 *
 * Сервер отвечает общей фразой и списком подробностей, и список до сих пор
 * нигде не читался: машинист читал «Паспорт заполнен не полностью» и не знал,
 * что править. Здесь проверяется отбор: понятные русские строки показываем,
 * идентификаторы вопросов и разбор схемы запроса (zod issues) — нет.
 */
describe('operatorErrorDetails', () => {
  it('объекты с русским текстом — это подробности полей', () => {
    const error = new ApiError(400, 'Паспорт заполнен не полностью', [
      {field: 'pileNumber', message: 'Укажите номер сваи по проекту'},
      {field: 'sets', message: 'В залоге нужны число ударов больше нуля и погружение от нуля'},
    ]);

    expect(operatorErrorDetails(error)).toEqual([
      'Укажите номер сваи по проекту',
      'В залоге нужны число ударов больше нуля и погружение от нуля',
    ]);
  });

  it('список строк — тоже подробности', () => {
    const error = new ApiError(400, 'Выберите, что произошло', ['Отметьте хотя бы один наблюдаемый признак']);

    expect(operatorErrorDetails(error)).toEqual(['Отметьте хотя бы один наблюдаемый признак']);
  });

  it('разбор схемы запроса (zod issues) наружу не выходит', () => {
    const error = new ApiError(400, 'Некорректная команда', [
      {
        code: 'invalid_type',
        path: ['entry', 'passport', 'pileNumber'],
        message: 'Invalid input: expected string, received undefined',
      },
      {code: 'too_small', path: ['entry', 'count'], message: 'Too small: expected number to be >0'},
    ]);

    expect(operatorErrorDetails(error)).toEqual([]);
  });

  it('идентификаторы вопросов проверки знаний машинисту не показываются', () => {
    const error = new ApiError(409, 'Не на все вопросы дан верный ответ', ['q-general-4', 'q-rigging-2']);

    expect(operatorErrorDetails(error)).toEqual([]);
  });

  it('чужие формы подробностей и не-`ApiError` — пустой список', () => {
    expect(operatorErrorDetails(new ApiError(409, 'Работа запрещена', {blocks: ['DOCUMENT_EXPIRED']}))).toEqual([]);
    expect(operatorErrorDetails(new ApiError(400, 'Паспорт заполнен не полностью'))).toEqual([]);
    expect(operatorErrorDetails(new Error('что-то не сошлось'))).toEqual([]);
    expect(operatorErrorDetails(new ApiError(400, 'Отказ', [null, 7, {message: 5}]))).toEqual([]);
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

/**
 * Судьба записи при немедленной отправке (аудит R82, находка 1).
 *
 * Раньше отказ по существу (400/409) прямо здесь вызывал `resolve` и удалял
 * запись с устройства, хотя тот же самый отказ при сливе очереди оставлял её
 * как `FAILED`. Один ответ сервера давал противоположный итог для данных:
 * потеря зависела только от того, была ли связь в момент нажатия.
 */
describe('sendCommand и отказ по существу', () => {
  const command = {
    command: 'log-production' as const,
    clientCommandId: 'c1',
    shiftId: 's1',
    entry: {kind: 'PILES' as const, pileGradeId: 'g1', count: 12},
  };

  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
      },
    });
  });

  it('409 — запись остаётся на устройстве как FAILED с причиной, ошибка брошена', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'Смена уже закрыта'}), {status: 409})));
    const error = await sendCommand(command).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({clientCommandId: 'c1', state: 'FAILED', lastError: 'Смена уже закрыта'});
  });

  it('успех — запись снимается с устройства', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({data: {}}), {status: 200})));
    await sendCommand(command);
    vi.unstubAllGlobals();

    expect(readQueue()).toHaveLength(0);
  });

  it('обрыв сети — запись ждёт отправки (PENDING), ошибка QueuedOffline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await sendCommand(command).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(QueuedOffline);
    expect(readQueue()[0].state).toBe('PENDING');
  });
});
