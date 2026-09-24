import {beforeEach, describe, expect, it} from 'vitest';
import {
  enqueue, flushQueue, isQueueable, readQueue, retry,
} from './offline-queue';
import {usePilingStore} from '@/lib/store';

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
});
