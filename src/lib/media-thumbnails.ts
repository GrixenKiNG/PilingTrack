/**
 * Накопитель ссылок на миниатюры.
 *
 * Каждая строка списка рисует свою миниатюру и раньше ходила за ссылкой сама.
 * На журнале отчётов это давало 14 запросов из 39 при открытии экрана (замер
 * 17.08.2026) и росло линейно с числом строк, а браузер держит не больше шести
 * соединений к одному хосту — список ждал несколько волн.
 *
 * Здесь запросы, пришедшие в пределах одного тика, собираются в один вызов
 * /api/media/download-batch. Плюс два следствия, ради которых это и сделано
 * именно так, а не переносом загрузки в родительский список:
 *
 *   - работает для любого экрана с миниатюрами, а не только для отчётов;
 *   - повторный монтаж (StrictMode в разработке, возврат на вкладку) берёт
 *     ссылку из кэша, а не ходит на сервер заново.
 *
 * Библиотеку кэширования не вводим: здесь нужен ровно этот случай — «дай
 * ссылку по идентификатору», и он умещается в файл.
 */

import { authFetch } from '@/lib/api';

/** Окно сборки. Достаточно, чтобы список успел смонтировать все строки. */
const FLUSH_DELAY_MS = 20;

/** Тот же потолок, что и у маршрута; больше он не примет. */
const MAX_BATCH = 100;

/**
 * Ссылка живёт час; обновляем заранее, чтобы не отдать ссылку, протухающую
 * прямо в руках у браузера, пока он её грузит.
 */
const CACHE_TTL_MS = 50 * 60 * 1000;

type Resolver = (url: string | null) => void;

interface CacheEntry {
  url: string | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const waiting = new Map<string, Resolver[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;

  const ids = [...waiting.keys()].slice(0, MAX_BATCH);
  if (ids.length === 0) return;

  const resolvers = new Map<string, Resolver[]>();
  for (const id of ids) {
    resolvers.set(id, waiting.get(id) ?? []);
    waiting.delete(id);
  }

  // Не поместившиеся в потолок уедут следующей пачкой.
  if (waiting.size > 0 && flushTimer === null) {
    flushTimer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
  }

  let urls: Record<string, string> = {};
  try {
    const response = await authFetch(
      `/api/media/download-batch?thumb=1&ids=${encodeURIComponent(ids.join(','))}`,
    );
    if (response.ok) {
      urls = ((await response.json()) as { urls?: Record<string, string> }).urls ?? {};
    }
  } catch {
    // Сеть отвалилась — раздаём null. Миниатюра не критична, строка списка
    // покажет запасной вид, а не сломается.
  }

  const expiresAt = Date.now() + CACHE_TTL_MS;
  for (const [id, callbacks] of resolvers) {
    const url = urls[id] ?? null;
    // Отсутствие ссылки тоже кэшируем: без этого строка с недоступным или
    // удалённым файлом дёргала бы сервер на каждой перерисовке.
    cache.set(id, { url, expiresAt });
    for (const callback of callbacks) callback(url);
  }
}

/**
 * Ссылка на миниатюру по идентификатору файла.
 *
 * Возвращает `null`, если файла нет, он недоступен этой роли или сеть
 * недоступна — вызывающая сторона показывает запасной вид.
 */
export function getThumbnailUrl(mediaId: string): Promise<string | null> {
  const cached = cache.get(mediaId);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  return new Promise<string | null>((resolve) => {
    const queue = waiting.get(mediaId);
    if (queue) {
      // Тот же идентификатор уже в очереди — второго запроса не будет.
      queue.push(resolve);
    } else {
      waiting.set(mediaId, [resolve]);
    }

    if (flushTimer === null) {
      flushTimer = setTimeout(() => { void flush(); }, FLUSH_DELAY_MS);
    }
  });
}

/** Сбросить кэш — для тестов и после удаления файла. */
export function clearThumbnailCache(): void {
  cache.clear();
}
