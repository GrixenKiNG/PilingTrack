'use client';

/**
 * Очередь команд на устройстве машиниста.
 *
 * ЗАЧЕМ. Сеть на площадке рвётся посреди смены. Раньше клиент был честно
 * онлайновым: не отправилось — показали «нет сети», введённое пропало. Для
 * человека в кабине это означает вводить сваи заново, а чаще — не вводить
 * вовсе и «записать потом на бумажке».
 *
 * ЧТО СЮДА ПОПАДАЕТ И ПОЧЕМУ ТОЛЬКО ОНО. В очередь идут только добавляющие
 * записи с ключом идемпотентности: выработка, осмотр, происшествие, поправка.
 * У них нет конфликтов по построению — повтор той же команды сервер узнаёт по
 * `clientCommandId` и второй записи не делает, а порядок между ними не важен.
 *
 * Переходы состояния смены (приём установки, завершение, закрытие) сюда НЕ
 * идут: они зависят от порядка и от живого ответа сервера. Отложить их значило
 * бы принимать решения о смене, не зная, в каком она состоянии, — а это уже
 * разрешение конфликтов, то есть отдельный продукт. Здесь честнее «нет сети».
 *
 * ХРАНИЛИЩЕ. localStorage, а не IndexedDB: в очереди лежат несколько
 * маленьких JSON-команд (снимки в неё не попадают), и синхронный доступ без
 * схемы и миграций проще и надёжнее. Любой доступ обёрнут: в приватном режиме
 * хранилище бросает, и падать из-за этого нельзя.
 */

const STORAGE_KEY = 'pilingtrack.operator.queue.v1';

/** `FAILED` — сервер отказал по существу: нужно решение человека, не повтор. */
export type QueuedCommandState = 'PENDING' | 'FAILED';

export interface QueuedCommand {
  clientCommandId: string;
  /** Подпись для человека: что именно лежит на устройстве. */
  label: string;
  command: unknown;
  queuedAt: string;
  attempts: number;
  state: QueuedCommandState;
  lastError: string | null;
}

/**
 * Команды, которые можно отложить. Всё остальное — только онлайн.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ ОСМОТРА. Он выглядит добавляющей записью, но двигает фазу
 * смены, а фаза живёт на сервере. Отложенный осмотр оставлял машиниста на том
 * же экране с кнопкой «Завершить»: экран не мог продвинуться, человек жал
 * снова, и каждое нажатие заводило новый ключ — в очередь ложился второй
 * осмотр той же смены (поймано при офлайн-прогоне 04.09.2026).
 *
 * Правило, которое из этого следует: откладывать можно только то, что ничего
 * не решает о состоянии смены. Каждое нажатие здесь — отдельная запись со
 * своим ключом, и повтор нажатия честно означает вторую запись, а не дубль.
 */
const QUEUEABLE = new Set([
  'log-production', 'report-incident', 'correct-production',
]);

const LABELS: Record<string, string> = {
  'log-production': 'Выработка',
  'report-incident': 'Происшествие',
  'correct-production': 'Поправка',
};

export function isQueueable(command: unknown): command is {command: string; clientCommandId: string} {
  if (typeof command !== 'object' || command === null) return false;
  const value = command as {command?: unknown; clientCommandId?: unknown};
  return typeof value.command === 'string'
    && QUEUEABLE.has(value.command)
    && typeof value.clientCommandId === 'string';
}

export function commandLabel(command: unknown): string {
  const name = (command as {command?: string} | null)?.command ?? '';
  return LABELS[name] ?? 'Запись';
}

// --- Хранилище ---

export class QueueStorageError extends Error {
  constructor() {
    super('Не удалось сохранить запись на устройстве. Не закрывайте форму: освободите место или восстановите связь и повторите.');
    this.name = 'QueueStorageError';
  }
}

function read(strict = false): QueuedCommand[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new QueueStorageError();
    return parsed as QueuedCommand[];
  } catch {
    if (strict) throw new QueueStorageError();
    // Reading the badge must not crash the screen; enqueue uses strict reads.
    return [];
  }
}

function write(queue: QueuedCommand[]): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new QueueStorageError();
    const value = JSON.stringify(queue);
    storage.setItem(STORAGE_KEY, value);
    if (storage.getItem(STORAGE_KEY) !== value) throw new QueueStorageError();
  } catch {
    throw new QueueStorageError();
  }
  notify();
}

// --- Подписка для интерфейса ---

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readQueue(): QueuedCommand[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

// --- Операции ---

/** Кладём до отправки: обрыв на середине запроса не должен терять запись. */
export function enqueue(command: {clientCommandId: string}): void {
  const queue = read(true);
  if (queue.some((item) => item.clientCommandId === command.clientCommandId)) return;
  queue.push({
    clientCommandId: command.clientCommandId,
    label: commandLabel(command),
    command,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    state: 'PENDING',
    lastError: null,
  });
  write(queue);
}

export function resolve(clientCommandId: string): void {
  write(read().filter((item) => item.clientCommandId !== clientCommandId));
}

/**
 * Вернуть отвергнутую запись в очередь.
 *
 * Без этого `FAILED` — тупик: запись висит вечно, и убрать её машинист не
 * может. Удаления здесь намеренно нет: стереть введённое человеком молча хуже,
 * чем оставить его на виду. Причина отказа могла и уйти — смену переоткрыли,
 * справочник поправили, — и тогда повтор пройдёт.
 */
export function retry(clientCommandId: string): void {
  write(read().map((item) => item.clientCommandId === clientCommandId
    ? {...item, state: 'PENDING' as const, lastError: null}
    : item));
}

export function markAttempt(clientCommandId: string, error: string | null, permanent: boolean): void {
  write(read().map((item) => item.clientCommandId === clientCommandId
    ? {...item, attempts: item.attempts + 1, lastError: error,
      state: permanent ? 'FAILED' as const : 'PENDING' as const}
    : item));
}

/**
 * Отправить всё отложенное. Возвращает, сколько ушло и сколько осталось.
 *
 * Записи с `FAILED` не трогаем: сервер отказал по существу (например, смена
 * чужая или число неверное), и повторять то же самое бессмысленно — это
 * решение человека. Они остаются видимыми, пока их не разберут.
 */
export async function flushQueue(
  send: (command: unknown) => Promise<unknown>,
): Promise<{sent: number; left: number}> {
  let sent = 0;
  for (const item of read()) {
    if (item.state === 'FAILED') continue;
    try {
      await send(item.command);
      resolve(item.clientCommandId);
      sent += 1;
    } catch (error) {
      const status = (error as {status?: number} | null)?.status;
      // 4xx — отказ по существу, повтор не поможет. Остальное (обрыв, 5xx) —
      // причина попробовать позже.
      const permanent = typeof status === 'number' && status >= 400 && status < 500;
      markAttempt(item.clientCommandId,
        error instanceof Error ? error.message : 'Не отправлено', permanent);
      if (!permanent) break; // сеть всё ещё лежит — остальные ждут
    }
  }
  return {sent, left: read().length};
}
