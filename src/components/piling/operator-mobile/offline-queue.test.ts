import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  AUTH_WAIT_MESSAGE, CSRF_REJECT_MESSAGE, discard, enqueue, flushQueue, foreignQueueSummary, isQueueable, markAttempt,
  QueueOwnershipError, QueueStorageError, readQueue, resolve, retry, subscribeQueue,
} from './offline-queue';
import {ApiError, QueuedOffline, sendCommand} from './api';
import {usePilingStore} from '@/lib/store';

// Прежний общий ключ (весь список одним значением) и приставка ключей отдельных команд.
const LEGACY_KEY = 'pilingtrack.operator.queue.v1';
const CMD_PREFIX = `${LEGACY_KEY}:cmd:`;

/** Подменить время постановки записи: так проверяем «прежний состав» без гонки часов. */
function setQueuedAt(clientCommandId: string, iso: string): void {
  const key = `${CMD_PREFIX}${clientCommandId}`;
  const raw = JSON.parse(globalThis.localStorage.getItem(key) as string) as {queuedAt: string};
  raw.queuedAt = iso;
  globalThis.localStorage.setItem(key, JSON.stringify(raw));
}

function commandKeys(): string[] {
  const storage = globalThis.localStorage;
  return Array.from({length: storage.length}, (_, index) => storage.key(index) as string)
    .filter((key) => key.startsWith(CMD_PREFIX)).sort();
}

/*
  Очередь держит введённое машинистом до подтверждения сервером. Ошибка здесь
  — это потерянная смена: сваи забиты, а в отчёте их нет, и заметят это через
  сутки. Поэтому проверяется именно то, что теряет данные молча.
*/

const piles = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES'}};
const inspection = {command: 'submit-checklist', clientCommandId: 'cX'};
// Вторая очередная запись — происшествие: осмотр в очередь больше не идёт.
const incident = {command: 'report-incident', clientCommandId: 'c2'};

// Своё хранилище, а не окружения: тест не должен зависеть от того, даёт ли
// среда localStorage, — иначе он молча проверял бы пустую очередь и проходил.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
    },
  });
});

describe('очередь команд на устройстве', () => {
  it('откладывает только то, что ничего не решает о состоянии смены', () => {
    expect(isQueueable(piles)).toBe(true);
    expect(isQueueable({command: 'report-incident', clientCommandId: 'i1'})).toBe(true);

    // Осмотр двигает фазу смены, а фаза живёт на сервере. Отложенный осмотр
    // оставлял машиниста на том же экране: он жал «Завершить» снова, и каждое
    // нажатие заводило новый ключ — второй осмотр той же смены.
    expect(isQueueable(inspection)).toBe(false);
    // Эти к тому же зависят от порядка.
    expect(isQueueable({command: 'close-shift', shiftId: 's1'})).toBe(false);
    expect(isQueueable({command: 'accept-equipment', clientCommandId: 'x'})).toBe(false);
  });

  it('повторная постановка той же команды не задваивает запись', () => {
    enqueue(piles);
    enqueue(piles);
    expect(readQueue()).toHaveLength(1);
  });

  it('повтор с исправленным составом заменяет отвергнутую запись (F-V1-INLINE-REJECT-b)', async () => {
    // Ключ после отказа приложение не меняет: машинист правит форму и жмёт
    // снова с тем же ключом. Без замены в очереди остался бы старый состав.
    const wrong = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 0}};
    const fixed = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 7}};
    enqueue(wrong);
    await flushQueue(async () => { throw Object.assign(new Error('отказ'), {status: 409}); });
    expect(readQueue()[0]).toMatchObject({state: 'FAILED', attempts: 1});

    enqueue(fixed);
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({state: 'PENDING', lastError: null, attempts: 1});
    expect(queue[0].command).toEqual(fixed);
  });

  it('ждущую запись повторный enqueue не переписывает (прежнее поведение)', () => {
    const first = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 3}};
    const other = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 9}};
    enqueue(first);
    enqueue(other);
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].state).toBe('PENDING');
    expect(queue[0].command).toEqual(first);
  });

  it('поздний результат прежней отправки не трогает заменённый состав (F-V1-QUEUE-VERSION)', async () => {
    // Немедленная отправка и слив очереди могут слать одну запись разом.
    // Пока ответ прежнего состава в пути, машинист исправил форму и положил
    // тем же ключом новый состав. Поздний ответ относится к прежнему: ни
    // покраснеть, ни исчезнуть новая запись не должна.
    const wrong = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 0}};
    const fixed = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 7}};
    enqueue(wrong);
    await flushQueue(async () => { throw Object.assign(new Error('отказ'), {status: 409}); });

    const oldQueuedAt = '2020-01-01T00:00:00.000Z';
    setQueuedAt('c1', oldQueuedAt);
    enqueue(fixed);
    expect(readQueue()[0].queuedAt).not.toBe(oldQueuedAt);

    markAttempt('c1', 'Смена закрыта', true, oldQueuedAt);
    resolve('c1', oldQueuedAt);

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({state: 'PENDING', lastError: null});
    expect(queue[0].command).toEqual(fixed);
  });

  it('результат с текущим queuedAt применяется как раньше (F-V1-QUEUE-VERSION)', () => {
    enqueue(piles);
    const queuedAt = readQueue()[0].queuedAt;

    markAttempt('c1', 'Смена закрыта', true, queuedAt);
    expect(readQueue()[0]).toMatchObject({state: 'FAILED', lastError: 'Смена закрыта', attempts: 1});

    resolve('c1', queuedAt);
    expect(readQueue()).toHaveLength(0);
  });

  it('без expectedQueuedAt поведение прежнее (F-V1-QUEUE-VERSION)', () => {
    enqueue(piles);
    markAttempt('c1', null, false);
    expect(readQueue()[0]).toMatchObject({state: 'PENDING', attempts: 1});

    resolve('c1');
    expect(readQueue()).toHaveLength(0);
  });

  it('чужую отвергнутую запись своим составом не заменяем (F-V1-QUEUE-VERSION)', async () => {
    // Ключ занят записью сменщика: положить свою нельзя, а заменить её —
    // отправить работу под чужой сессией. Отказываем понятным текстом.
    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    const wrong = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 0}};
    const mine = {command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES', count: 7}};
    enqueue(wrong);
    await flushQueue(async () => { throw Object.assign(new Error('отказ'), {status: 409}); });

    usePilingStore.setState({currentUser: {id: 'op-night', name: 'Петров П.'} as never});
    expect(() => enqueue(mine)).toThrow(QueueOwnershipError);
    expect(() => enqueue(mine)).toThrow('Запись с этим ключом принадлежит другому пользователю. Обновите страницу.');

    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({state: 'FAILED', ownerId: 'op-day'});
    expect(queue[0].command).toEqual(wrong);
    usePilingStore.setState({currentUser: null});
  });

  it('сквозной: отказ, затем поворот с исправленным составом и обрыв не теряет правку (F-V1-INLINE-REJECT-b)', async () => {
    const wrong = {command: 'log-production' as const, clientCommandId: 'c1', shiftId: 's1',
      entry: {kind: 'PILES' as const, pileGradeId: 'g1', count: 0}};
    const fixed = {command: 'log-production' as const, clientCommandId: 'c1', shiftId: 's1',
      entry: {kind: 'PILES' as const, pileGradeId: 'g1', count: 5}};
    const realFetch = globalThis.fetch;
    try {
      // Первый заход — отказ сервера по существу: запись краснеет.
      globalThis.fetch = (async () => new Response(
        JSON.stringify({error: 'Смена закрыта'}), {status: 409, headers: {'Content-Type': 'application/json'}},
      )) as typeof fetch;
      const rejection = await sendCommand(wrong).catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(ApiError);
      expect((rejection as ApiError).status).toBe(409);
      expect((rejection as ApiError).message).toBe('Смена закрыта');
      expect(readQueue()[0].state).toBe('FAILED');

      // Повтор с исправленным составом обрывается на середине запроса.
      globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
      await expect(sendCommand(fixed)).rejects.toBeInstanceOf(QueuedOffline);

      const queue = readQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].state).toBe('PENDING');
      expect(queue[0].command).toEqual(fixed);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('обрыв сети оставляет записи в очереди и не долбит остальные', async () => {
    enqueue(piles);
    enqueue(incident);
    let calls = 0;
    const result = await flushQueue(async () => {
      calls += 1;
      throw new Error('нет сети');
    });
    expect(result).toEqual({sent: 0, left: 2});
    expect(calls).toBe(1); // сеть лежит — вторую не пробуем
    expect(readQueue().every((item) => item.state === 'PENDING')).toBe(true);
  });

  it('отказ сервера по существу помечает запись и не мешает остальным', async () => {
    enqueue(piles);
    enqueue(incident);
    await flushQueue(async (command) => {
      if ((command as {clientCommandId: string}).clientCommandId === 'c1') {
        throw Object.assign(new Error('Количество должно быть больше нуля'), {status: 400});
      }
      return {};
    });
    const queue = readQueue();
    expect(queue).toHaveLength(1); // осмотр ушёл
    expect(queue[0].state).toBe('FAILED');
    expect(queue[0].lastError).toContain('больше нуля');
  });

  it('отвергнутая запись не повторяется сама, но уходит после «Повторить»', async () => {
    enqueue(piles);
    await flushQueue(async () => {
      throw Object.assign(new Error('отказ'), {status: 400});
    });

    let touched = 0;
    await flushQueue(async () => { touched += 1; return {}; });
    expect(touched).toBe(0); // сам по себе повтор бессмыслен

    retry('c1');
    expect(readQueue()[0].state).toBe('PENDING');
    const result = await flushQueue(async () => ({}));
    expect(result).toEqual({sent: 1, left: 0});
  });

  it('«слишком часто» и истёкший вход — не отказ: запись ждёт, а не краснеет', async () => {
    // Хвост после суток без связи упирается в ограничитель частоты; сессия
    // истекает посреди отправки. Раньше оба случая запирали запись в FAILED.
    enqueue(piles);
    await flushQueue(async () => { throw Object.assign(new Error('Too many requests'), {status: 429}); });
    expect(readQueue()[0].state).toBe('PENDING');

    await flushQueue(async () => { throw Object.assign(new Error('Войдите в систему'), {status: 401}); });
    expect(readQueue()[0]).toMatchObject({state: 'PENDING', lastError: AUTH_WAIT_MESSAGE});
  });

  it('CSRF-403 при сливе — запись ждёт, слив остановлен (аудит R76, находка 12)', async () => {
    // Отказ проверки безопасности лечится перезагрузкой страницы, а не решением
    // человека: запись не должна краснеть, а остальные — уходить под тем же
    // расхождением Origin/Host. Ведём себя как при сетевом сбое.
    enqueue(piles);
    enqueue(incident);
    let calls = 0;
    const result = await flushQueue(async () => {
      calls += 1;
      throw new ApiError(403, CSRF_REJECT_MESSAGE, undefined, 'csrf');
    });
    expect(result).toEqual({sent: 0, left: 2});
    expect(calls).toBe(1); // CSRF не лечится повтором — вторую запись не пробуем
    const queue = readQueue();
    expect(queue.every((item) => item.state === 'PENDING')).toBe(true);
    expect(queue[0].lastError).toBe(CSRF_REJECT_MESSAGE);
  });

  it('убрать с устройства можно только отвергнутую запись', async () => {
    enqueue(piles);
    discard('c1');
    expect(readQueue()).toHaveLength(1); // ждущая ещё может уйти

    await flushQueue(async () => { throw Object.assign(new Error('Смена закрыта'), {status: 409}); });
    discard('c1');
    expect(readQueue()).toHaveLength(0);
  });

  it('испорченное хранилище не перезаписывается пустой очередью', () => {
    globalThis.localStorage.setItem(LEGACY_KEY, '{broken');
    resolve('c1');
    expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBe('{broken');
  });

  it('страница входа в Wi-Fi со статусом 200 — не успех: запись остаётся', async () => {
    // Сеть гостиницы отвечает на перехваченный запрос своей HTML-страницей.
    // Раньше это считалось принятой записью, и она уходила из очереди.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>Вход в сеть</html>', {status: 200})) as typeof fetch;
    try {
      await expect(sendCommand({command: 'log-production', clientCommandId: 'c1', shiftId: 's1',
        entry: {kind: 'PILES', pileGradeId: 'g1', count: 3}})).rejects.toBeInstanceOf(QueuedOffline);
      expect(readQueue()).toHaveLength(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('записи прежнего машиниста не уходят под сессией сменщика', async () => {
    // Планшет на установке общий: без владельца записи первого ушли бы под
    // сессией второго.
    usePilingStore.setState({currentUser: {id: 'op-day'} as never});
    enqueue(piles);

    usePilingStore.setState({currentUser: {id: 'op-night'} as never});
    const sent: unknown[] = [];
    expect(readQueue()).toHaveLength(0);
    expect(await flushQueue(async (command) => { sent.push(command); })).toEqual({sent: 0, left: 0});
    expect(sent).toHaveLength(0);

    // Вернулся хозяин — записи на месте и уходят.
    usePilingStore.setState({currentUser: {id: 'op-day'} as never});
    expect(readQueue()).toHaveLength(1);
    usePilingStore.setState({currentUser: null});
  });

  it('сменщик видит, что на телефоне лежат чужие записи, и чьи они', () => {
    // Аудит R43 №2: чужие записи ждали хозяина молча — если он не входил на
    // этом телефоне, выработка терялась, и никто об этом не знал.
    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    enqueue(piles);
    enqueue(incident);

    usePilingStore.setState({currentUser: {id: 'op-night', name: 'Петров П.'} as never});
    expect(foreignQueueSummary()).toEqual({count: 2, owners: ['Иванов И.']});

    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    expect(foreignQueueSummary()).toEqual({count: 0, owners: []});
    usePilingStore.setState({currentUser: null});
  });
});

/*
  Каждая команда лежит под своим ключом. Общий список одним значением терял
  записи при двух вкладках: A читает, B читает и пишет, A пишет старый список со
  своей записью — запись B пропала (аудит 17.10.2026, потеряна QA_B).
*/
describe('несколько вкладок и разбор старого формата', () => {
  type QueueModule = typeof import('./offline-queue');

  /** Новый экземпляр модуля — это «ещё одна вкладка» над тем же localStorage. */
  async function openTab(): Promise<QueueModule> {
    vi.resetModules();
    return import('./offline-queue');
  }

  /**
   * Общее хранилище, в котором на `readNumber`-е чтении выполняется `between`
   * (как в пробе аудита: читавший получает снимок ДО чужой записи).
   */
  function interleavedStorage(
    readNumber: number, between: () => void, armed = true,
  ): {fired: () => boolean; arm: () => void} {
    const store = new Map<string, string>();
    let reads = 0;
    let fired = false;
    let counting = armed;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => {
          const snapshot = store.get(key) ?? null;
          if (counting) reads += 1;
          if (counting && reads === readNumber) { fired = true; between(); }
          return snapshot;
        },
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        get length() { return store.size; },
        key: (index: number) => [...store.keys()][index] ?? null,
      },
    });
    return {fired: () => fired, arm: () => { counting = true; reads = 0; }};
  }

  it.each([1, 2, 3])('запись второй вкладки между чтениями первой не теряется (чтение №%i)', async (readNumber) => {
    const tabA = await openTab();
    const tabB = await openTab();
    const storage = interleavedStorage(readNumber, () => tabB.enqueue(
      {command: 'log-production', clientCommandId: 'QA_B', entry: {kind: 'PILES', count: 1}} as never));
    tabA.enqueue({command: 'log-production', clientCommandId: 'QA_A', entry: {kind: 'PILES', count: 2}} as never);

    expect(storage.fired()).toBe(true);
    for (const tab of [tabA, tabB]) {
      expect(tab.readQueue().map((item) => item.clientCommandId).sort()).toEqual(['QA_A', 'QA_B']);
    }
  });

  it.each([1, 2, 3])('снятие записи в одной вкладке не стирает запись, добавленную в другой (чтение №%i)', async (readNumber) => {
    const tabA = await openTab();
    const tabB = await openTab();
    const storage = interleavedStorage(readNumber, () => tabB.enqueue(
      {command: 'log-production', clientCommandId: 'c2'} as never), false);
    tabA.enqueue({command: 'log-production', clientCommandId: 'c1'} as never);
    storage.arm();
    tabA.resolve('c1');

    expect(storage.fired()).toBe(true);
    expect(tabA.readQueue().map((item) => item.clientCommandId)).toEqual(['c2']);
  });

  it('старый общий список раскладывается по ключам, ничего не теряя', () => {
    const legacy = [
      {ownerId: 'op-day', ownerName: 'Иванов И.', clientCommandId: 'c1', label: 'Выработка',
        command: {command: 'log-production', clientCommandId: 'c1'}, queuedAt: '2026-10-17T05:00:00.000Z',
        attempts: 2, state: 'FAILED', lastError: 'Смена закрыта'},
      {clientCommandId: 'c2', label: 'Происшествие', command: {command: 'report-incident', clientCommandId: 'c2'},
        queuedAt: '2026-10-17T04:00:00.000Z', attempts: 0, state: 'PENDING', lastError: null},
    ];
    globalThis.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    const queue = readQueue();
    expect(queue.map((item) => item.clientCommandId)).toEqual(['c2', 'c1']); // порядок — по queuedAt
    expect(queue[1]).toEqual(legacy[0]);
    expect(commandKeys()).toEqual([`${CMD_PREFIX}c1`, `${CMD_PREFIX}c2`]);
    expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();

    // Старый ключ ушёл: снятая запись не воскресает при следующем чтении.
    resolve('c2');
    expect(readQueue().map((item) => item.clientCommandId)).toEqual(['c1']);
    usePilingStore.setState({currentUser: null});
  });

  it('разбор старого списка не затирает более свежую запись под своим ключом', () => {
    globalThis.localStorage.setItem(LEGACY_KEY, JSON.stringify([
      {clientCommandId: 'c1', label: 'Выработка', command: {command: 'log-production', clientCommandId: 'c1'},
        queuedAt: '2026-10-17T05:00:00.000Z', attempts: 0, state: 'PENDING', lastError: null},
    ]));
    globalThis.localStorage.setItem(`${CMD_PREFIX}c1`, JSON.stringify({
      clientCommandId: 'c1', label: 'Выработка', command: {command: 'log-production', clientCommandId: 'c1', entry: 'new'},
      queuedAt: '2026-10-17T06:00:00.000Z', attempts: 1, state: 'FAILED', lastError: 'x',
    }));

    expect(readQueue()).toHaveLength(1);
    expect(readQueue()[0]).toMatchObject({queuedAt: '2026-10-17T06:00:00.000Z', state: 'FAILED'});
    expect(globalThis.localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('если разложить не удалось, старый список остаётся нетронутым и ничего не пропадает', () => {
    const legacyValue = JSON.stringify([
      {clientCommandId: 'c1', label: 'Выработка', command: {command: 'log-production', clientCommandId: 'c1'},
        queuedAt: '2026-10-17T05:00:00.000Z', attempts: 0, state: 'PENDING', lastError: null},
    ]);
    const store = new Map<string, string>([[LEGACY_KEY, legacyValue]]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key.startsWith(CMD_PREFIX)) throw new Error('QuotaExceededError');
          store.set(key, value);
        },
        removeItem: (key: string) => { store.delete(key); },
        get length() { return store.size; },
        key: (index: number) => [...store.keys()][index] ?? null,
      },
    });

    expect(() => readQueue()).not.toThrow();
    expect(store.get(LEGACY_KEY)).toBe(legacyValue);
  });

  it('одна испорченная запись не стирает соседние и не мешает класть остальные', async () => {
    enqueue(piles);
    globalThis.localStorage.setItem(`${CMD_PREFIX}c1`, '{broken');

    enqueue(incident);
    expect(readQueue().map((item) => item.clientCommandId)).toEqual(['c2']);
    expect(globalThis.localStorage.getItem(`${CMD_PREFIX}c1`)).toBe('{broken');

    // Испорченную запись не заменяем новой молча.
    expect(() => enqueue(piles)).toThrow(QueueStorageError);
    expect(globalThis.localStorage.getItem(`${CMD_PREFIX}c1`)).toBe('{broken');

    const sent: unknown[] = [];
    expect(await flushQueue(async (command) => { sent.push(command); })).toEqual({sent: 1, left: 0});
    expect(sent).toEqual([incident]);
    expect(globalThis.localStorage.getItem(`${CMD_PREFIX}c1`)).toBe('{broken');
  });

  it('порядок записей — по queuedAt', () => {
    enqueue(piles);
    enqueue(incident);
    setQueuedAt('c1', '2099-01-01T00:00:00.000Z');
    expect(readQueue().map((item) => item.clientCommandId)).toEqual(['c2', 'c1']);
  });

  it('подписка реагирует на изменение ключей очереди в другой вкладке, но не чужих ключей', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQueue(listener);
    try {
      window.dispatchEvent(new StorageEvent('storage', {key: `${CMD_PREFIX}c1`}));
      expect(listener).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new StorageEvent('storage', {key: LEGACY_KEY}));
      expect(listener).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new StorageEvent('storage', {key: 'equipment-view-mode'}));
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });
});
