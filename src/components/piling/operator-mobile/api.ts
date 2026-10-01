'use client';

import type {
  ChecklistAnswer, ChecklistStage, KnowledgeQuestion, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  AUTH_WAIT_MESSAGE, classifyFailure, commandLabel, enqueue, isQueueable, markAttempt,
  QueueStorageError, resolve,
} from './offline-queue';

/**
 * Клиент мобильного места.
 *
 * Добавляющие записи (выработка, происшествие, поправка) переживают
 * обрыв сети: они ложатся в очередь на устройстве и уходят при связи. Повтор
 * безопасен — сервер узнаёт команду по `clientCommandId` и второй записи не
 * делает.
 *
 * Переходы состояния смены остаются строго онлайн: откладывать их значило бы
 * решать судьбу смены, не зная её состояния. Подробнее — в `offline-queue.ts`.
 */

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Текст ошибки для машиниста.
 *
 * ПОЧЕМУ НЕ `error.message`. Сетевой сбой в браузере — это `TypeError` с
 * англоязычной строкой: «Failed to fetch» (Chrome/Firefox), «NetworkError when
 * attempting to fetch resource», «Load failed» (Safari). Отдавать её в русский
 * интерфейс нельзя: машинист читает «Failed to fetch» как поломку приложения и
 * звонит диспетчеру вместо того, чтобы проверить связь (аудит R76, находка 5;
 * тот же класс уже закрыт в форме входа, `login-page.tsx:44-48`).
 *
 * Отказ сервера (`ApiError`) несёт русский текст от сервера — его и показываем:
 * «Смена закрыта» объясняет положение лучше любой общей фразы.
 *
 * ПОЧЕМУ ОТДЕЛЬНО `QueueStorageError` И `QueuedOffline`. Обе несут готовый
 * русский текст, который нельзя затирать общей фразой. У `QueueStorageError`
 * это предупреждение о возможной ПОТЕРЕ данных («Память браузера недоступна
 * (частный режим?) — без связи запись не сохранится. Не закрывайте форму…»);
 * у `QueuedOffline` — «сохранено на устройстве, отправим при связи». Раньше их
 * текст показывался как `error.message`, а общий возврат его съедал.
 */
export function operatorErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof QueueStorageError) return error.message;
  if (error instanceof QueuedOffline) return error.message;
  if (error instanceof TypeError) return 'Нет связи с сервером. Проверьте интернет и повторите.';
  return 'Не удалось выполнить действие. Повторите.';
}

/**
 * Строки подробностей отказа — то, чего не хватает в общей фразе сервера.
 *
 * ПОЧЕМУ ЭТО НУЖНО. Отказ по существу сервер отвечает общей фразой и списком
 * подробностей: «Паспорт заполнен не полностью» и какие поля не заполнены,
 * «Чек-лист заполнен не полностью» и какие пункты, «Залог № 2 заполнен неверно»
 * и что в нём не так (`production.ts:286,297`, `checklist.ts:127`). До сих пор
 * список собирался в `ApiError` и нигде не читался: машинист заполняет полтора
 * десятка полей паспорта, читает «заполнен не полностью» и не знает, что
 * править (аудит R76, находка 10).
 *
 * ПОЧЕМУ ЗДЕСЬ ОТБОР, А НЕ ПРОСТО ПОКАЗ `details`. В этом поле приходит три
 * разные вещи: названные человеку поля (список строк у происшествия — «Выберите,
 * что произошло»; список объектов с русским `message`/`label` у паспорта и
 * чек-листа), идентификаторы вопросов проверки знаний (`admission.ts:320-324`) и
 * разбор схемы запроса — zod issues со своими кодами и английскими
 * техническими сообщениями (`command/route.ts:196`). Показать можно только
 * первое: идентификатор вопроса и техническое сообщение схемы машинисту ничего
 * не говорят. Отличительный признак понятной строки один — русский текст, и
 * другого признака у нас нет.
 *
 * Всё, что не опознано, — пустой список. Выдумать подробность хуже, чем
 * показать одну общую фразу.
 */
export function operatorErrorDetails(error: unknown): string[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return [];
  const lines: string[] = [];
  for (const item of error.details) {
    const text = typeof item === 'string' ? item : detailText(item);
    // Кириллица — признак того, что строку писал человек для человека.
    if (text && /[А-Яа-яЁё]/.test(text)) lines.push(text.trim());
  }
  return lines;
}

/** Текст подробности в известных формах: `{message}` у паспорта и чек-листа, `{label}` — на будущее. */
function detailText(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const {message, label} = item as {message?: unknown; label?: unknown};
  if (typeof message === 'string') return message;
  return typeof label === 'string' ? label : null;
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as
    {data?: T; error?: string; details?: unknown} | null;
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? 'Сервер не ответил', payload?.details);
  }
  // Успех — только разобранный ответ нашего сервера. Сеть гостиницы или
  // оператора связи отдаёт на перехваченный запрос свою страницу входа со
  // статусом 200: раньше это считалось успехом, запись уходила из очереди, а
  // сервер её так и не видел. Статус 0 — «не ответ сервера», повторить позже.
  if (payload === null || typeof payload !== 'object') {
    throw new ApiError(0, 'Ответ пришёл не от сервера приложения — возможно, сеть требует входа (Wi‑Fi). Запись осталась на устройстве.');
  }
  return payload.data as T;
}

export async function fetchState(input: {
  coordinates?: {latitude: number; longitude: number} | null;
  equipmentId?: string;
}): Promise<OperatorMobileState> {
  const query = new URLSearchParams();
  if (input.coordinates) {
    query.set('lat', String(input.coordinates.latitude));
    query.set('lon', String(input.coordinates.longitude));
  }
  if (input.equipmentId) query.set('equipmentId', input.equipmentId);

  const response = await fetch(`/api/operator/mobile/state?${query.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  return parse<OperatorMobileState>(response);
}

/** Набор вопросов проверки знаний: тот же разбор ответа, что у прочих запросов. */
export interface KnowledgeAttempt {
  questions: KnowledgeQuestion[];
  attemptToken: string;
}

/**
 * Текст для чужого ответа на загрузке вопросов.
 *
 * `parse` про такой ответ говорит «Запись осталась на устройстве» — на этом
 * экране никакой записи нет, и та фраза здесь только сбивает с толку.
 */
const NOT_SERVER_RESPONSE =
  'Ответ пришёл не от сервера приложения — возможно, сеть требует входа (Wi‑Fi). Проверьте соединение и повторите.';

export async function fetchKnowledgeAttempt(signal?: AbortSignal): Promise<KnowledgeAttempt> {
  const response = await fetch('/api/operator/knowledge-attempt', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  let attempt: KnowledgeAttempt;
  try {
    attempt = await parse<KnowledgeAttempt>(response);
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) throw new ApiError(0, NOT_SERVER_RESPONSE);
    throw error;
  }
  // Форма ответа — тоже проверка: 200 с чужим JSON (портал Wi‑Fi, прокси) без
  // `questions` оставил бы экран навсегда на «Получаем вопросы…».
  if (!attempt || !Array.isArray(attempt.questions) || typeof attempt.attemptToken !== 'string') {
    throw new ApiError(0, NOT_SERVER_RESPONSE);
  }
  return attempt;
}

/** Один залог: серия ударов и погружение сваи за неё. */
export interface PileDrivingSetInput {
  blows: number;
  penetrationMm: number;
  dropHeightM?: number | null;
}

export interface PilePassportInput {
  pileNumber: string;
  /** Залоги по порядку. Номер задаёт сам массив. */
  sets?: PileDrivingSetInput[];
  picketId?: string;
  designHeadLevelM?: number | null;
  actualHeadLevelM?: number | null;
  drivenDepthM?: number | null;
  refusalSetPenetrationMm?: number | null;
  refusalSetBlows?: number | null;
  designRefusalMm?: number | null;
  totalBlows?: number | null;
  blowsLastMeter?: number | null;
  redriven?: boolean;
  followerUsed?: boolean;
  headCutOff?: boolean;
  planDeviationMm?: number | null;
  tiltPercent?: number | null;
  dropHeightM?: number | null;
  mediaIds?: string[];
  note?: string;
}

export type ProductionEntryInput =
  | {kind: 'PILES'; pileGradeId: string; count: number; comment?: string}
  | {kind: 'PILE_PASSPORT'; pileGradeId: string; passport: PilePassportInput}
  | {kind: 'DRILLING'; typeId: string; count: number; metersPerUnit: number}
  | {kind: 'DOWNTIME'; reasonId: string; startedAt: string; endedAt: string; comment?: string};

type Command =
  | {command: 'acknowledge-briefing'}
  | {command: 'confirm-ppe'; productionDate: string; items: string[]}
  | {command: 'submit-knowledge'; attemptToken: string; picks: {questionId: string; picked: number}[]}
  | {command: 'accept-equipment'; clientCommandId: string; equipmentId: string; shiftType: 'DAY' | 'NIGHT'}
  | {command: 'submit-checklist'; clientCommandId: string; shiftId: string; equipmentId: string; stage: ChecklistStage; answers: ChecklistAnswer[]}
  | {command: 'log-production'; clientCommandId: string; shiftId: string; entry: ProductionEntryInput}
  | {command: 'correct-production'; clientCommandId: string; shiftId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; entryId: string; actual: number; reason: string}
  | {command: 'report-incident'; clientCommandId: string; shiftId: string; category: string; signs: string[]; injured: boolean; description: string; mediaIds?: string[]}
  | {command: 'finish-work'; shiftId: string}
  /** Отчёт сдан, смена ещё живёт до передачи машины — контур готовности. */
  | {command: 'submit-report'; shiftId: string; comment: string}
  | {command: 'close-shift'; shiftId: string; comment: string};

/**
 * Запись принята устройством, но ещё не сервером: лежит в очереди и уйдёт,
 * когда вернётся сеть. Не ошибка — форму можно закрывать, данные не потеряны.
 *
 * `reason` отличает отложение из-за истёкшего входа (`auth`) от обрыва связи
 * (`network`): у первого есть выход — войти снова, и о нём экран обязан сказать
 * вслух, у второго делать нечего, кроме ожидания. Текст «отправим после входа»
 * для этого не годится: по строке нельзя принять решение (аудит R76, находка 8).
 */
export class QueuedOffline extends Error {
  readonly reason: 'auth' | 'network';

  constructor(readonly label: string, when: 'при связи' | 'после входа' = 'при связи') {
    super(`${label}: сохранено на устройстве, отправим ${when}`);
    this.name = 'QueuedOffline';
    this.reason = when === 'после входа' ? 'auth' : 'network';
  }
}

/**
 * Отправка уже стоящей в очереди команды: без повторной постановки в очередь,
 * иначе дозапись сама себя бы туда и клала.
 */
export function sendQueuedCommand(command: unknown): Promise<unknown> {
  return postCommand<unknown>(command);
}

async function postCommand<T>(command: unknown): Promise<T> {
  const response = await fetch('/api/operator/mobile/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify(command),
  });
  return parse<T>(response);
}

export async function sendCommand<T = unknown>(command: Command): Promise<T> {
  // Команды перехода состояния смены отправляем как есть: откладывать их
  // нельзя (см. offline-queue.ts).
  if (!isQueueable(command)) return postCommand<T>(command);

  // Сначала в очередь, потом в сеть: обрыв посреди запроса не должен терять
  // введённое. Успех снимает запись из очереди, а ОТКАЗ ПО СУЩЕСТВУ (4xx,
  // кроме 401/408/425/429) теперь НЕ снимает, а помечает `FAILED` с текстом
  // сервера — как это уже делает слив очереди (`offline-queue.ts`, sendAll).
  // Раньше `resolve` удалял запись прямо здесь, и один и тот же 409 давал
  // противоположный итог для данных: при немедленной отправке введённое
  // исчезало с устройства (строка состояния при этом рапортовала
  // «Синхронизировано · нет очереди»), а при сливе очереди оставалось в
  // плашке с составом и причиной. Потеря зависела лишь от того, была ли связь
  // в момент нажатия (аудит R82, находка 1). Обрыв, «слишком часто» и
  // истёкший вход по-прежнему оставляют запись ждать.
  //
  // Память браузера недоступна (частный режим) — это не повод не отправлять
  // при живой связи. Тогда шлём напрямую и, если не ушло, отдаём ошибку
  // хранилища: форма остаётся открытой, введённое не пропадает.
  try {
    enqueue(command);
  } catch (storageError) {
    if (!(storageError instanceof QueueStorageError)) throw storageError;
    try {
      return await postCommand<T>(command);
    } catch (error) {
      if (error instanceof ApiError && classifyFailure(error.status) === 'permanent') throw error;
      throw storageError;
    }
  }
  try {
    const result = await postCommand<T>(command);
    resolve(command.clientCommandId);
    return result;
  } catch (error) {
    const kind = classifyFailure(error instanceof ApiError ? error.status : null);
    if (kind === 'permanent') {
      // Не удаляем: запись остаётся видимой машинисту с составом и причиной,
      // а убрать её он может сам через `discard` (R82, находка 1).
      markAttempt(command.clientCommandId,
        error instanceof Error ? error.message : 'Сервер отклонил запись', true);
      throw error;
    }
    markAttempt(command.clientCommandId,
      kind === 'auth' ? AUTH_WAIT_MESSAGE : error instanceof Error ? error.message : 'Не отправлено', false);
    throw new QueuedOffline(commandLabel(command), kind === 'auth' ? 'после входа' : 'при связи');
  }
}

/**
 * Загрузка снимка к пункту осмотра.
 *
 * Три шага: попросить у сервера ссылку, положить файл в хранилище, подтвердить.
 * Снимок привязывается к ключу команды и пункту — записи дефекта в этот момент
 * ещё нет, а привязать фото к чему-то надо, иначе его нельзя проверить.
 */
export async function uploadPhoto(input: {
  file: File;
  clientCommandId: string;
  /** Пункт осмотра. Не задан — снимок относится к команде целиком. */
  itemId?: string;
  entityType?: 'equipment_defect' | 'safety_incident';
}): Promise<string> {
  // Сервер сверяет вид и идентификатор при подтверждении команды: у пункта
  // осмотра это «ключ команды и пункт», у происшествия — только ключ
  // команды, потому что снимок относится к событию, а не к его части.
  const entityType = input.entityType ?? 'equipment_defect';
  const entityId = input.itemId ? `${input.clientCommandId}:${input.itemId}` : input.clientCommandId;
  const grant = await fetch('/api/media', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify({
      fileName: input.file.name || 'photo.jpg',
      contentType: input.file.type || 'image/jpeg',
      fileSize: input.file.size,
      entityType,
      entityId,
    }),
  });
  // Медиа-маршрут отвечает объектом напрямую, без обёртки `data` — здесь
  // разбираем его сами, а не общим `parse`.
  const granted = await grant.json().catch(() => null) as
    {mediaId?: string; uploadUrl?: string; error?: string} | null;
  if (!grant.ok || !granted?.mediaId || !granted.uploadUrl) {
    throw new ApiError(grant.status, granted?.error ?? 'Не удалось получить ссылку для снимка');
  }
  const {mediaId, uploadUrl} = granted;

  const stored = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {'Content-Type': input.file.type || 'image/jpeg'},
    body: input.file,
  });
  if (!stored.ok) throw new ApiError(stored.status, 'Снимок не загрузился');

  const confirmed = await fetch(`/api/media/${mediaId}/confirm`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!confirmed.ok) throw new ApiError(confirmed.status, 'Снимок не подтверждён сервером');

  return mediaId;
}

/** Ключ команды: один на нажатие кнопки, чтобы повтор при обрыве не удваивал запись. */
export function newCommandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Координаты телефона. Отказ в доступе — не ошибка: работаем без погоды. */
export function currentPosition(): Promise<{latitude: number; longitude: number} | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({latitude: position.coords.latitude, longitude: position.coords.longitude}),
      () => resolve(null),
      {timeout: 5_000, maximumAge: 600_000},
    );
  });
}
