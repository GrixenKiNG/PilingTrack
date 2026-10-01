/**
 * Текст ошибки для машиниста (аудит R76, находка 5).
 *
 * Сетевой сбой в браузере — это `TypeError` с английской строкой («Failed to
 * fetch», «Load failed» в Safari). Раньше она уходила на экран как есть: в
 * русском интерфейсе машинист читал «Failed to fetch» и звонил диспетчеру про
 * поломку приложения вместо того, чтобы проверить связь.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, fetchKnowledgeAttempt, fetchState, operatorErrorDetails, operatorErrorText, QueuedOffline, sendCommand, uploadPhoto} from '../api';
import {QueueOwnershipError, QueueStorageError, CSRF_REJECT_MESSAGE, readQueue} from '../offline-queue';

describe('operatorErrorText', () => {
  it('сетевой сбой — «Нет связи с сервером…», а не английская строка браузера', () => {
    expect(operatorErrorText(new TypeError('Failed to fetch')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
    expect(operatorErrorText(new TypeError('NetworkError when attempting to fetch resource')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
    expect(operatorErrorText(new TypeError('Load failed')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
  });

  // Истёкший таймаут `AbortSignal.timeout` — это `DOMException` «TimeoutError»,
  // а не `TypeError`. Машинисту текст нужен тот же: это обрыв связи (R76 №13).
  it('истёкший таймаут запроса — та же фраза про связь', () => {
    expect(operatorErrorText(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
      .toBe('Нет связи с сервером. Проверьте интернет и повторите.');
    expect(operatorErrorText(new DOMException('signal is aborted without reason', 'AbortError')))
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

  // Ключ занят чужой записью: у отказа один выход, и общая фраза его скрыла бы
  // (F-V1-QUEUE-VERSION). Важно и то, что это не `QueueStorageError`: та в
  // `sendCommand` означает «память недоступна» и уводит в отправку мимо очереди.
  it('ключ занят записью сменщика — машинист читает, что делать', () => {
    expect(operatorErrorText(new QueueOwnershipError())).toBe(
      'Запись с этим ключом принадлежит другому пользователю. Обновите страницу.',
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

  // Чек-лист прикладывает название пункта: иначе пять одинаковых «Пункт не
  // заполнен» машинисту ничего не говорят (F-V1-ERROR-DETAILS-b).
  it('название пункта и текст отказа склеиваются через «: »', () => {
    const error = new ApiError(400, 'Чек-лист заполнен не полностью', [
      {itemId: 'mast', message: 'Пункт не заполнен', label: 'Мачта и стрела: сварные швы, деформации, крепёж'},
      {itemId: 'leaks', message: 'Пункт не заполнен', label: 'Под машиной сухо: пятен масла, ОЖ, топлива нет'},
    ]);

    expect(operatorErrorDetails(error)).toEqual([
      'Мачта и стрела: сварные швы, деформации, крепёж: Пункт не заполнен',
      'Под машиной сухо: пятен масла, ОЖ, топлива нет: Пункт не заполнен',
    ]);
  });

  it('только label или только message — показываем то, что есть', () => {
    expect(operatorErrorDetails(new ApiError(400, 'Отказ', [{label: 'Уровень масла двигателя'}])))
      .toEqual(['Уровень масла двигателя']);
    expect(operatorErrorDetails(new ApiError(400, 'Отказ', [{message: 'Пункт не заполнен'}])))
      .toEqual(['Пункт не заполнен']);
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
    expect(operatorErrorText(error)).toBe(
      'Сервер временно недоступен (код 502). Запись сохранена — отправим автоматически.',
    );
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

/**
 * CSRF-отказ — временный, а не приговор (аудит R76, находка 12).
 *
 * 403 от `csrf-protection.ts` («CSRF validation failed: origin mismatch»)
 * возникает при расхождении `Origin` и `Host` — приложение открыто по IP, через
 * прокси, вкладка пережила смену адреса. Причина снимается перезагрузкой
 * страницы, поэтому запись обязана остаться `PENDING` и уйти сама, а машинист —
 * прочитать русское указание вместо английской строки. Прочие 403 (роль, чужая
 * смена) остаются отказом по существу (`FAILED`), как раньше.
 */
describe('sendCommand и CSRF-отказ', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('403 «CSRF validation failed» — запись остаётся PENDING, текст русский', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'CSRF validation failed: origin mismatch'}), {status: 403})));
    const error = await sendCommand(command).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBe('csrf');
    expect(operatorErrorText(error)).toBe(CSRF_REJECT_MESSAGE);
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({clientCommandId: 'c1', state: 'PENDING', lastError: CSRF_REJECT_MESSAGE});
  });

  it('403 «Нет доступа» — отказ по существу: запись FAILED, как раньше', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'Нет доступа'}), {status: 403})));
    const error = await sendCommand(command).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBeUndefined();
    expect(operatorErrorText(error)).toBe('Нет доступа');
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({clientCommandId: 'c1', state: 'FAILED', lastError: 'Нет доступа'});
  });
});

/**
 * Таймаут запроса (аудит R76, находка 13).
 *
 * «Повисшее» соединение не завершает `fetch`, а очередь держит единый `inFlight`
 * до завершения промиса (`offline-queue.ts`): без таймаута ни таймер, ни событие
 * `online`, ни «Повторить» не отправляли ничего до перезагрузки страницы. Здесь
 * проверяется, что запросу передан сигнал таймаута и что его истечение — это
 * сетевой сбой (запись остаётся `PENDING`), а не отказ по существу.
 *
 * Настоящий `AbortSignal.timeout` тикает своим таймером мимо фейковых часов,
 * поэтому в тесте он подменён тем же по смыслу: `setTimeout` на фейковых часах
 * обрывает `AbortController`.
 */
describe('таймаут запроса', () => {
  const command = {
    command: 'log-production' as const,
    clientCommandId: 'c1',
    shiftId: 's1',
    entry: {kind: 'PILES' as const, pileGradeId: 'g1', count: 12},
  };

  let timeouts: number[];

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
    timeouts = [];
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('повисший fetch обрывается через 20 с: запись PENDING, ошибка QueuedOffline', async () => {
    // Сервер не отвечает сам — промис завершается только сигналом таймаута.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
    })));

    const result = sendCommand(command).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await result;

    expect(timeouts).toContain(20_000);
    expect(error).toBeInstanceOf(QueuedOffline);
    expect(readQueue()[0]).toMatchObject({clientCommandId: 'c1', state: 'PENDING'});
  });

  // Файл снимка идёт напрямую в хранилище и на медленной сети грузится дольше:
  // у PUT таймаут больше, чем у запроса ссылки и подтверждения.
  it('файл снимка грузится с большим таймаутом, подтверждение — с обычным', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(null, {status: 200});
      if (url === '/api/media') {
        return new Response(JSON.stringify({mediaId: 'm1', uploadUrl: 'https://storage.test/put'}), {status: 200});
      }
      return new Response(JSON.stringify({}), {status: 200});
    }));

    const file = new File(['x'], 'photo.jpg', {type: 'image/jpeg'});
    const mediaId = await uploadPhoto({file, clientCommandId: 'c1'});

    expect(mediaId).toBe('m1');
    expect(timeouts).toEqual([20_000, 120_000, 20_000]);
  });
});

/**
 * Текст отказа при подтверждении снимка (аудит R76, находка 11).
 *
 * Третий шаг загрузки подменял ЛЮБОЙ ответ сервера общей фразой «Снимок не
 * подтверждён сервером»: понятный отказ 422 («Содержимое файла не соответствует
 * заявленному типу…») не доходил до машиниста, и он жал то же битое фото снова
 * вместо того, чтобы снять заново. Здесь проверяется разбор тела отказа и
 * отсечка чужого (английского) текста.
 */
describe('uploadPhoto: подтверждение снимка', () => {
  const file = new File(['x'], 'photo.jpg', {type: 'image/jpeg'});

  /** Первые два шага успешны, ответ на подтверждение задаёт сам тест. */
  function stubConfirm(confirm: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(null, {status: 200});
      if (url === '/api/media') {
        return new Response(JSON.stringify({mediaId: 'm1', uploadUrl: 'https://storage.test/put'}), {status: 200});
      }
      return confirm();
    }));
  }

  it('422 с русским текстом — ApiError с этим текстом и статусом', async () => {
    stubConfirm(() => new Response(
      JSON.stringify({error: 'Содержимое файла не соответствует заявленному типу image/jpeg'}),
      {status: 422}));
    const error = await uploadPhoto({file, clientCommandId: 'c1'}).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe('Содержимое файла не соответствует заявленному типу image/jpeg');
  });

  it('отказ без JSON — общая фраза', async () => {
    stubConfirm(() => new Response('<html>502</html>', {status: 500}));
    const error = await uploadPhoto({file, clientCommandId: 'c1'}).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toBe('Снимок не подтверждён сервером');
  });

  it('422 с английским текстом — общая фраза, не английская строка', async () => {
    stubConfirm(() => new Response(
      JSON.stringify({error: 'CSRF validation failed: origin mismatch'}),
      {status: 422}));
    const error = await uploadPhoto({file, clientCommandId: 'c1'}).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe('Снимок не подтверждён сервером');
  });
});

/**
 * Текст отказа хранилища на PUT файла снимка (аудит R76, находка 24).
 *
 * Раньше ЛЮБОЙ неуспешный PUT давал общую фразу «Снимок не загрузился»: по ней
 * нельзя было понять, повторять (ссылка истекла, хранилище недоступно) или
 * переснимать (файл слишком большой). Здесь проверяется текст по статусу;
 * тело хранилища (XML) не разбираем. Обрыв сети — не ответ хранилища, текст
 * остаётся прежним.
 */
describe('uploadPhoto: отказ хранилища на PUT', () => {
  const file = new File(['x'], 'photo.jpg', {type: 'image/jpeg'});

  /** Первый шаг отдаёт ссылку, ответ на PUT задаёт сам тест. */
  function stubPut(put: () => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/media') {
        return new Response(JSON.stringify({mediaId: 'm1', uploadUrl: 'https://storage.test/put'}), {status: 200});
      }
      if (init?.method === 'PUT') return put();
      return new Response(null, {status: 200});
    }));
  }

  it.each([
    [403, 'Ссылка для загрузки устарела. Повторите — получим новую.'],
    [413, 'Снимок слишком большой. Сделайте фото заново с меньшим качеством.'],
    [503, 'Хранилище временно недоступно. Повторите позже.'],
    [400, 'Снимок не загрузился (код 400).'],
  ])('PUT %i — понятный машинисту текст', async (status, text) => {
    stubPut(() => new Response('<Error><Code>…</Code></Error>', {status}));
    const error = await uploadPhoto({file, clientCommandId: 'c1'}).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).message).toBe(text);
    expect(operatorErrorText(error)).toBe(text);
  });

  it('обрыв сети на PUT — прежний текст про связь', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/media') {
        return new Response(JSON.stringify({mediaId: 'm1', uploadUrl: 'https://storage.test/put'}), {status: 200});
      }
      throw new TypeError('Failed to fetch');
    }));
    const error = await uploadPhoto({file, clientCommandId: 'c1'}).catch((caught: unknown) => caught);
    vi.unstubAllGlobals();

    expect(operatorErrorText(error)).toBe('Нет связи с сервером. Проверьте интернет и повторите.');
  });
});

/**
 * Таймаут без родных `AbortSignal.any`/`AbortSignal.timeout` (F-V1-FETCH-TIMEOUT-b).
 *
 * `AbortSignal.any` есть только с Safari 17.4 / Chrome 116, а цели Next по
 * умолчанию — Safari 16.4 / Chrome 111. На iPhone с iOS 16.x–17.3 прежний
 * `timeoutSignal` вызывал `AbortSignal.any` синхронно, тот бросал `TypeError`, и
 * запрос с внешним сигналом падал всегда — машинист навсегда оставался на «Нет
 * связи». Здесь родные помощники снимаются на время теста, как в старом браузере,
 * и проверяется, что сигнал собирается на `AbortController` и ведёт себя так же.
 */
describe('таймаут запроса без AbortSignal.any/timeout', () => {
  const nativeTimeout = AbortSignal.timeout;
  const nativeAny = AbortSignal.any;
  // В happy-dom статики `AbortSignal` наследуются от базового класса и не
  // удаляются (`Reflect.deleteProperty` не снимает унаследованное). Тень
  // собственным значением `undefined` воспроизводит старый браузер надёжно.
  const statics = AbortSignal as unknown as {timeout?: unknown; any?: unknown};

  beforeEach(() => {
    statics.timeout = undefined;
    statics.any = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    statics.timeout = nativeTimeout;
    statics.any = nativeAny;
  });

  it('fetchState с внешним сигналом не бросает TypeError и доходит до сервера', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({data: {phase: 'IDLE'}}), {status: 200}));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchState({signal: controller.signal})).resolves.toEqual({phase: 'IDLE'});
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('зависший fetch обрывается через 20 с, ошибка — таймаут связи', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
    })));

    const result = fetchState({}).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(20_000);
    const error = await result;

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('TimeoutError');
    expect(operatorErrorText(error)).toBe('Нет связи с сервером. Проверьте интернет и повторите.');
  });

  it('внешний abort обрывает запрос раньше таймаута, причину передаёт свою', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      seen = init?.signal ?? undefined;
      init?.signal?.addEventListener('abort', () => reject(init?.signal?.reason));
    })));

    const result = fetchState({signal: controller.signal}).catch((caught: unknown) => caught);
    controller.abort(new DOMException('Отменено', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);
    const error = await result;

    expect(seen?.aborted).toBe(true);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('с родными помощниками сигнал по-прежнему берётся из AbortSignal.timeout/any', async () => {
    statics.timeout = nativeTimeout;
    statics.any = nativeAny;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const anySpy = vi.spyOn(AbortSignal, 'any');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({data: {}}), {status: 200})));

    await fetchState({signal: new AbortController().signal});

    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    expect(anySpy).toHaveBeenCalled();
  });
});

/**
 * Признак нашего ответа — поле `data` (аудит R76, находка 14).
 *
 * Сети-посредники (гостиничный портал, прокси, WAF) отвечают 200 с чужим JSON
 * вида `{"status":"ok"}`. Раньше это считалось успехом: `sendCommand` снимал
 * запись с устройства, хотя сервер её не видел, а `fetchState` возвращал
 * `undefined` и экран навсегда оставался на «Загрузка смены». Здесь проверяется,
 * что успехом считается только ответ с полем `data`, а чужой JSON — сетевой сбой:
 * запись остаётся `PENDING` и уйдёт повтором.
 */
describe('ответ 200 без поля data — не успех', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('чужой JSON на команду — запись остаётся PENDING, ошибка QueuedOffline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({status: 'ok'}), {status: 200})));
    const error = await sendCommand(command).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QueuedOffline);
    expect(operatorErrorText(error)).toBe('Выработка: сохранено на устройстве, отправим при связи');
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({clientCommandId: 'c1', state: 'PENDING'});
  });

  it('чужой JSON на состояние — понятная ошибка, а не undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({status: 'ok'}), {status: 200})));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).message)
      .toBe('Ответ пришёл не от сервера. Проверьте подключение (вход в Wi-Fi) и повторите.');
  });

  it('ответ с полем data — успех, как раньше', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({data: {phase: 'IDLE'}}), {status: 200})));

    await expect(fetchState({})).resolves.toEqual({phase: 'IDLE'});
    await expect(sendCommand(command)).resolves.toEqual({phase: 'IDLE'});
    expect(readQueue()).toHaveLength(0);
  });
});

/**
 * Текст отказа при ошибочном статусе и неразобранном теле (аудит R76, находки
 * 21 и 25).
 *
 * Прежде не-JSON тело (страница шлюза 502/504, HTML-ошибка прокси) подменялось
 * общей фразой «Сервер не ответил» — той же, что при обрыве связи. Машинист по
 * ней шёл «искать связь», хотя связь была, а сервер отдал ошибку шлюза. Теперь
 * 5xx и 4xx объясняются по-разному и с кодом. Отдельно подменяется точный текст
 * схемы «Некорректная команда» (рассогласование приложения и сервера). На
 * способность записи отправиться повтором это не влияет: решает статус
 * (`classifyFailure`), а не текст.
 */
describe('ошибочный статус без разобранного тела', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('502 с HTML — код в тексте, а не общая фраза про связь', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', {status: 502})));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(502);
    expect(operatorErrorText(error))
      .toBe('Сервер временно недоступен (код 502). Запись сохранена — отправим автоматически.');
  });

  it('404 с HTML — отказ сервера с кодом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>404 Not Found</html>', {status: 404})));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect(operatorErrorText(error)).toBe('Сервер отказал (код 404). Обновите экран и повторите.');
  });

  it('400 «Некорректная команда» — текст с шагом для машиниста', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'Некорректная команда', details: [{code: 'invalid_type'}]}),
      {status: 400})));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(operatorErrorText(error))
      .toBe('Не удалось отправить — обновите экран и повторите. Если повторяется, сообщите администратору.');
    // Разбор схемы (zod issues) наружу по-прежнему не выходит.
    expect(operatorErrorDetails(error)).toEqual([]);
  });

  it('400 с другим русским текстом — без подмены', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({error: 'Смена уже закрыта'}), {status: 400})));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(operatorErrorText(error)).toBe('Смена уже закрыта');
  });

  it('обрыв сети — прежний текст про связь', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await fetchState({}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TypeError);
    expect(operatorErrorText(error)).toBe('Нет связи с сервером. Проверьте интернет и повторите.');
  });

  it('5xx с HTML на команде — запись остаётся ждать отправки', async () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>503</html>', {status: 503})));
    const command = {
      command: 'log-production' as const,
      clientCommandId: 'c1',
      shiftId: 's1',
      entry: {kind: 'PILES' as const, pileGradeId: 'g1', count: 12},
    };

    const error = await sendCommand(command).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(QueuedOffline);
    expect(readQueue()[0]).toMatchObject({clientCommandId: 'c1', state: 'PENDING'});
  });
});
