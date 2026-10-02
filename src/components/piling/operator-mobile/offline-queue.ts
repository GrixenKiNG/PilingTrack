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
 * записи с ключом идемпотентности: выработка, происшествие, поправка.
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

import {usePilingStore} from '@/lib/store';

const STORAGE_KEY = 'pilingtrack.operator.queue.v1';

/** `FAILED` — сервер отказал по существу: нужно решение человека, не повтор. */
export type QueuedCommandState = 'PENDING' | 'FAILED';

export interface QueuedCommand {
  /**
   * Кто записал. Планшет на установке общий на сменщиков, а хранилище одно на
   * устройство: без владельца записи прежнего машиниста уходили бы под сессией
   * вошедшего следом. Чужие записи ждут, пока войдёт их хозяин. У записей,
   * положенных до появления поля, владельца нет — их считаем своими.
   */
  ownerId?: string | null;
  /** Имя владельца — чтобы сменщику было кого назвать (аудит R43 №2). */
  ownerName?: string | null;
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

const CORRECTION_KINDS: Record<string, string> = {PILES: 'сваи', DRILLING: 'бурение', DOWNTIME: 'простой'};

function clock(iso: unknown): string {
  const date = typeof iso === 'string' ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})
    : '—';
}

/**
 * Что именно лежит в записи — цифрами, а не словом «Выработка».
 *
 * Отвергнутую запись машинист вносит заново руками, и без этой строки ему
 * пришлось бы вспоминать, сколько свай он тогда записал.
 */
export function describeCommand(command: unknown): string {
  const value = (command ?? {}) as Record<string, unknown>;
  if (value.command === 'log-production') {
    const entry = (value.entry ?? {}) as Record<string, unknown>;
    if (entry.kind === 'PILES') return `сваи: ${entry.count} шт`;
    if (entry.kind === 'PILE_PASSPORT') {
      const passport = (entry.passport ?? {}) as {pileNumber?: string; sets?: unknown[]};
      const sets = Array.isArray(passport.sets) ? `, залогов: ${passport.sets.length}` : '';
      return `паспорт сваи № ${passport.pileNumber ?? '—'}${sets}`;
    }
    if (entry.kind === 'DRILLING') return `бурение: ${entry.count} шт × ${entry.metersPerUnit} м`;
    if (entry.kind === 'DOWNTIME') return `простой ${clock(entry.startedAt)}–${clock(entry.endedAt)}`;
  }
  if (value.command === 'correct-production') {
    return `поправка (${CORRECTION_KINDS[String(value.kind)] ?? 'запись'}): ${value.actual}, причина: ${value.reason}`;
  }
  if (value.command === 'report-incident') {
    const text = typeof value.description === 'string' ? value.description : '';
    return `происшествие: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
  }
  return 'состав записи не распознан';
}

/**
 * Как понимать отказ сервера.
 *
 * `permanent` — отказ по существу (смена закрыта, число неверное): повтор того
 * же самого не поможет, нужно решение человека. `auth` — сессия истекла:
 * запись цела и уйдёт после входа. `temporary` — всё остальное, включая
 * «слишком часто» (429): длинный хвост после суток без связи упирается в
 * ограничитель частоты, и считать это отказом значило бы запереть записи.
 */
export type FailureKind = 'permanent' | 'auth' | 'temporary';

export function classifyFailure(status: number | null | undefined): FailureKind {
  if (status === 401) return 'auth';
  if (typeof status !== 'number' || status < 400 || status >= 500) return 'temporary';
  if (status === 408 || status === 425 || status === 429) return 'temporary';
  return 'permanent';
}

export const AUTH_WAIT_MESSAGE = 'Войдите снова — запись отправится после входа';

/**
 * Отказ проверки безопасности (CSRF) — временный, хотя и 403.
 *
 * `csrf-protection.ts` отдаёт 403 с английским текстом «CSRF validation failed…»,
 * когда `Origin` не сошёлся с `Host`: приложение открыто по IP, через прокси или
 * вкладка пережила смену адреса. Причина снимается перезагрузкой страницы,
 * поэтому повтор записи осмыслен — в отличие от прочих 403 (чужая роль, чужая
 * смена), которые остаются `permanent`. Русское указание машинисту несёт
 * `ApiError` (аудит R76, находка 12).
 */
export const CSRF_REJECT_MESSAGE =
  'Запрос отклонён проверкой безопасности. Обновите страницу — запись сохранена на телефоне и уйдёт после обновления.';

/**
 * Тот же отказ проверки безопасности, но у команды, которая в очередь не
 * попадает: переходы состояния смены (`close-shift`, `finish-work`) и шаг
 * снимка. Обещать сохранение записи здесь нельзя — её нет ни на телефоне, ни
 * в очереди, и после обновления страницы действие придётся выполнить заново
 * (аудит R89, находка 1).
 */
export const CSRF_REJECT_NOT_QUEUED_MESSAGE =
  'Запрос отклонён проверкой безопасности. Обновите страницу и повторите действие.';

/**
 * Признак CSRF-отказа на ошибке отправки. Читаем структурно (поле `reason`), а не
 * через `instanceof ApiError`: этот модуль не может импортировать `api.ts` —
 * тот импортирует его (циклическая зависимость).
 */
export function isCsrfFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as {reason?: unknown}).reason === 'csrf';
}

// --- Хранилище ---

export class QueueStorageError extends Error {
  constructor(readonly reason: 'full' | 'unavailable' = 'full') {
    super(reason === 'unavailable'
      ? 'Память браузера недоступна (частный режим?) — без связи запись не сохранится. Не закрывайте форму и отправьте её при связи.'
      : 'Не удалось сохранить запись на устройстве. Не закрывайте форму: освободите место или восстановите связь и повторите.');
    this.name = 'QueueStorageError';
  }
}

/**
 * Ключ команды занят записью другого машиниста.
 *
 * Планшет на установке общий: под сессией сменщика может лежать отвергнутая
 * запись его предшественника с тем же ключом. Заменить её своим составом
 * нельзя — она ушла бы под чужой сессией (или чужая работа под нашей), — а
 * положить вторую запись с тем же ключом не даёт само хранилище. Не
 * `QueueStorageError`: тот в `sendCommand` означает «память недоступна» и
 * приводит к прямой отправке в обход очереди. Здесь отправлять нечего —
 * машинист должен увидеть этот текст (F-V1-QUEUE-VERSION).
 */
export class QueueOwnershipError extends Error {
  constructor() {
    super('Запись с этим ключом принадлежит другому пользователю. Обновите страницу.');
    this.name = 'QueueOwnershipError';
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

function currentOwnerId(): string | null {
  return usePilingStore.getState().currentUser?.id ?? null;
}

function isMine(item: QueuedCommand): boolean {
  return !item.ownerId || item.ownerId === currentOwnerId();
}

function write(queue: QueuedCommand[]): void {
  let storage: Storage | undefined;
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = undefined;
  }
  if (!storage) throw new QueueStorageError('unavailable');
  try {
    const value = JSON.stringify(queue);
    storage.setItem(STORAGE_KEY, value);
    if (storage.getItem(STORAGE_KEY) !== value) throw new QueueStorageError();
  } catch {
    throw new QueueStorageError();
  }
  notify();
}

/**
 * Изменить очередь, прочитав её строго.
 *
 * Нестрогое чтение превращает испорченное значение в пустой список, и запись
 * этого списка стирала бы все неотправленные сваи разом. Если прочитать
 * нельзя — ничего не пишем: лучше оставить как есть, чем затереть.
 */
function mutate(change: (queue: QueuedCommand[]) => QueuedCommand[]): void {
  let queue: QueuedCommand[];
  try {
    queue = read(true);
  } catch {
    return;
  }
  write(change(queue));
}

// --- Подписка для интерфейса ---

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Вторая вкладка того же браузера пишет в то же хранилище: без этого экран
// первой показывал бы очередь, которой уже нет.
function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === STORAGE_KEY) notify();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage);
  };
}

export function readQueue(): QueuedCommand[] {
  return read().filter(isMine);
}

export function pendingCount(): number {
  return readQueue().length;
}

/**
 * Чужие записи на этом устройстве — сколько и чьи.
 *
 * Под сессией сменщика они не уходят и уходить не должны: выработка ушла бы
 * не тому человеку. Но и молчать о них нельзя (аудит R43 №2): если хозяин
 * больше не войдёт на этом телефоне, сваи потеряются, и никто не узнает.
 * Сменщику показываем, что они лежат, чтобы он сообщил хозяину или мастеру.
 */
export function foreignQueueSummary(): {count: number; owners: string[]} {
  const foreign = read().filter((item) => !isMine(item));
  const owners = [...new Set(foreign.map((item) => item.ownerName).filter((name): name is string => !!name))];
  return {count: foreign.length, owners};
}

// --- Операции ---

/**
 * Кладём до отправки: обрыв на середине запроса не должен терять запись.
 *
 * ЕСЛИ ЗАПИСЬ С ЭТИМ КЛЮЧОМ УЖЕ ЕСТЬ И ОНА `FAILED` — ЗАМЕНЯЕМ её состав.
 * Новый ключ приложение заводит только после успеха или `QueuedOffline`
 * (`operator-mobile-app.tsx`, run()), поэтому машинист, исправив форму и нажав
 * снова, приходит с тем же ключом. Без замены в очереди остался бы старый
 * неверный состав, а исправленный потерялся бы, оборвись повтор на середине:
 * `markAttempt` перевёл бы старую запись в `PENDING`, форма закрылась бы как
 * `QueuedOffline`, а позже слив отправил бы прежний состав и снова получил
 * отказ (F-V1-INLINE-REJECT-b, регрессия принятой F-V1-INLINE-REJECT; R82).
 * Ждущую (`PENDING`) запись не трогаем — она уже снаряжена и уйдёт как есть.
 * ЧУЖУЮ отвергнутую запись тоже не трогаем: ключ занят, а состав принадлежит
 * прежнему машинисту (см. `QueueOwnershipError`).
 * `attempts` не обнуляем: счётчик ведётся по записи, а не по составу.
 * `queuedAt` при замене обновляем: он отличает состав от прежнего, и по нему
 * поздний ответ на старую отправку узнаёт, что запись уже другая.
 */
export function enqueue(command: {clientCommandId: string}): void {
  const queue = read(true);
  const existing = queue.find((item) => item.clientCommandId === command.clientCommandId);
  if (existing) {
    if (existing.state !== 'FAILED') return;
    if (!isMine(existing)) throw new QueueOwnershipError();
    existing.command = command;
    existing.label = commandLabel(command);
    existing.state = 'PENDING';
    existing.lastError = null;
    existing.queuedAt = new Date().toISOString();
    write(queue);
    return;
  }
  queue.push({
    ownerId: currentOwnerId(),
    ownerName: usePilingStore.getState().currentUser?.name ?? null,
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

/**
 * Снять отправленную запись с устройства.
 *
 * `expectedQueuedAt` — состав, за который пришёл ответ. Пока запрос был в
 * пути, машинист мог исправить форму и положить тем же ключом НОВЫЙ состав:
 * `enqueue` тогда обновил `queuedAt`. Поздний успех относится к прежнему
 * составу, и снимать по нему новую запись нельзя (F-V1-QUEUE-VERSION).
 * Не передан — поведение прежнее.
 */
export function resolve(clientCommandId: string, expectedQueuedAt?: string): void {
  mutate((queue) => queue.filter((item) =>
    item.clientCommandId !== clientCommandId
    || (expectedQueuedAt !== undefined && item.queuedAt !== expectedQueuedAt)));
}

/**
 * Вернуть отвергнутую запись в очередь.
 *
 * Без этого `FAILED` — тупик: запись висит вечно. Причина отказа могла и
 * уйти — смену переоткрыли, справочник поправили, — и тогда повтор пройдёт.
 * Сама по себе смена состояния ничего не отправляет: отправку запускает
 * вызывающий (`useOfflineQueue`).
 */
export function retry(clientCommandId: string): void {
  mutate((queue) => queue.map((item) => item.clientCommandId === clientCommandId
    ? {...item, state: 'PENDING' as const, lastError: null}
    : item));
}

/**
 * Убрать отвергнутую запись с устройства — только по явному решению человека.
 *
 * Молча стирать введённое нельзя, но и держать вечно то, что сервер не примет
 * никогда (смена закрыта, отчёт сдан), тоже: красная строка, которую нечем
 * убрать, приучает не смотреть на красные строки. Экран спрашивает
 * подтверждение и показывает состав записи, чтобы её можно было внести заново.
 * Ждущие отправки записи так не убрать — они ещё могут уйти.
 */
export function discard(clientCommandId: string): void {
  mutate((queue) => queue.filter((item) =>
    item.clientCommandId !== clientCommandId || item.state !== 'FAILED'));
}

/**
 * Отметить попытку отправки: `permanent` — сервер отказал по существу.
 *
 * `expectedQueuedAt` — тот же предохранитель, что у `resolve`: если запись уже
 * заменена новым составом, отказ на прежний состав её не трогает — иначе
 * исправленное машинистом (F-V1-INLINE-REJECT-b) молча покраснело бы от
 * старого ответа (F-V1-QUEUE-VERSION).
 */
export function markAttempt(
  clientCommandId: string, error: string | null, permanent: boolean, expectedQueuedAt?: string,
): void {
  mutate((queue) => queue.map((item) => {
    if (item.clientCommandId !== clientCommandId) return item;
    if (expectedQueuedAt !== undefined && item.queuedAt !== expectedQueuedAt) return item;
    return {...item, attempts: item.attempts + 1, lastError: error,
      state: permanent ? 'FAILED' as const : 'PENDING' as const};
  }));
}

let inFlight: Promise<{sent: number; left: number}> | null = null;

/**
 * Отправить всё отложенное. Возвращает, сколько ушло и сколько осталось.
 *
 * Записи с `FAILED` не трогаем: сервер отказал по существу (например, смена
 * чужая или число неверное), и повторять то же самое бессмысленно — это
 * решение человека. Они остаются видимыми, пока их не разберут.
 *
 * Одновременно идёт одна отправка: её зовут и таймер, и событие «связь
 * появилась», и кнопка «Повторить» — две параллельные отправки слали бы
 * одну запись дважды (сервер узнает её по ключу, но это лишний трафик).
 */
export function flushQueue(
  send: (command: unknown) => Promise<unknown>,
): Promise<{sent: number; left: number}> {
  inFlight ??= sendAll(send).finally(() => { inFlight = null; });
  return inFlight;
}

async function sendAll(
  send: (command: unknown) => Promise<unknown>,
): Promise<{sent: number; left: number}> {
  let sent = 0;
  for (const item of readQueue()) {
    if (item.state === 'FAILED') continue;
    // Состав запоминаем ДО отправки: пока ответ в пути, машинист может
    // заменить его (enqueue обновит queuedAt). Тогда поздний результат
    // относится к прежнему составу и новую запись трогать нельзя.
    const queuedAt = item.queuedAt;
    try {
      await send(item.command);
      resolve(item.clientCommandId, queuedAt);
      sent += 1;
    } catch (error) {
      // CSRF-403 — не отказ по существу: причина (расхождение `Origin`/`Host`)
      // снимается перезагрузкой страницы. Запись остаётся `PENDING`, а слив
      // останавливаем, как при сетевом сбое, — остальные подождут
      // (аудит R76, находка 12).
      if (isCsrfFailure(error)) {
        markAttempt(item.clientCommandId,
          error instanceof Error ? error.message : CSRF_REJECT_MESSAGE, false, queuedAt);
        break;
      }
      const kind = classifyFailure((error as {status?: number} | null)?.status);
      markAttempt(item.clientCommandId,
        kind === 'auth' ? AUTH_WAIT_MESSAGE : error instanceof Error ? error.message : 'Не отправлено',
        kind === 'permanent', queuedAt);
      // Сеть лежит, сервер занят или нужен вход — остальные ждут.
      if (kind !== 'permanent') break;
    }
  }
  return {sent, left: readQueue().length};
}
