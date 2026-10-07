'use client';

import type {
  ChecklistAnswer, ChecklistStage, KnowledgeQuestion, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  AUTH_WAIT_MESSAGE, classifyFailure, commandLabel, CSRF_REJECT_MESSAGE,
  CSRF_REJECT_NOT_QUEUED_MESSAGE, enqueue, isCsrfFailure, isQueueable, markAttempt,
  QueueOwnershipError, QueueStorageError, readQueue, resolve,
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
  /**
   * `reason` отличает отказ проверки безопасности (`'csrf'`) от прочих отказов
   * сервера. Такой 403 лечится перезагрузкой страницы, а не решением человека,
   * и очередь не должна считать его `permanent` (аудит R76, находка 12).
   */
  constructor(
    readonly status: number, message: string, readonly details?: unknown, readonly reason?: 'csrf',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Общий текст сетевого сбоя: обрыв связи, истёкший таймаут запроса.
 *
 * Обе ветви `operatorErrorText` отвечают машинисту одним и тем же, поэтому текст
 * живёт в одной константе — иначе правка формулировки в одной ветви дала бы два
 * разных ответа на один и тот же сбой (R90, находка 6).
 */
const NETWORK_FAILURE_TEXT = 'Нет связи с сервером. Проверьте интернет и повторите.';

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
 * `QueueOwnershipError` — того же рода: у неё один понятный выход («обновите
 * страницу»), и общая фраза этот выход скрыла бы.
 */
export function operatorErrorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof QueueStorageError) return error.message;
  if (error instanceof QueueOwnershipError) return error.message;
  if (error instanceof QueuedOffline) return error.message;
  // Истёкший таймаут запроса (`AbortSignal.timeout`) приходит как `DOMException`
  // «TimeoutError» (в старых браузерах — «AbortError»). Для машиниста это тот же
  // обрыв связи: на связь и надо смотреть, запись при этом остаётся на
  // устройстве и уйдёт повтором (R76, находка 13).
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return NETWORK_FAILURE_TEXT;
  }
  if (error instanceof TypeError) return NETWORK_FAILURE_TEXT;
  return 'Не удалось выполнить действие. Повторите.';
}

/**
 * Признак строки, написанной для человека по-русски.
 *
 * Сервер пишет машинисту русским текстом, а технические сообщения приходят
 * английскими: сетевой сбой браузера («Failed to fetch»), разбор схемы запроса
 * (zod issues), служебные строки медиа-маршрута. Кириллица — единственный
 * доступный признак «это можно показывать»: английское и техническое машинисту
 * ничего не говорит. Непустая — пустая строка и одни пробелы признаком не
 * считаются (R90, находка 4).
 */
export function isHumanRussianText(text: unknown): text is string {
  return typeof text === 'string' && text.trim() !== '' && /[А-Яа-яЁё]/.test(text);
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
    if (isHumanRussianText(text)) lines.push(text.trim());
  }
  return lines;
}

/**
 * Текст подробности в известных формах: `{message}` у паспорта, `{label, message}`
 * у чек-листа (сервер прикладывает название пункта — иначе пять строк «Пункт не
 * заполнен» не различить), `{label}` — на будущее.
 *
 * Есть оба поля — отдаём «название: что не так». Иначе по одной фразе без
 * названия пункта машинист не знает, какой из пяти пустых пунктов править.
 */
function detailText(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const {message, label} = item as {message?: unknown; label?: unknown};
  const hasMessage = typeof message === 'string';
  const hasLabel = typeof label === 'string';
  if (hasMessage && hasLabel) return `${label}: ${message}`;
  if (hasMessage) return message;
  return hasLabel ? label : null;
}

/**
 * Текст для чужого JSON-ответа: пришёл 200, но это не наш сервер.
 *
 * Сети-посредники умеют отвечать 200 с JSON вида `{"status":"ok"}` — так же
 * охотно, как HTML-страницей входа. Раньше такой ответ считался успехом:
 * `sendCommand` снимал запись с устройства (`resolve`), хотя сервер её не
 * видел, а `fetchState` возвращал `undefined` и экран навсегда оставался на
 * «Загрузка смены» (аудит R76, находка 14).
 */
const NOT_SERVER_JSON =
  'Ответ пришёл не от сервера. Проверьте подключение (вход в Wi-Fi) и повторите.';

/**
 * Текст отказа сервера, тело которого не разобралось (аудит R76, находка 21).
 *
 * ПОЧЕМУ НЕ ОБЩЕЕ «Сервер не ответил». Так выглядит и страница шлюза (502/504),
 * и обрыв связи, но поводы разные: при обрыве связи искать надо её, а при
 * ошибке шлюза связь есть — сервер (или прокси перед ним) отдал отказ. Одна
 * фраза отправляла машиниста «искать связь» при живом сервере. Код называем,
 * чтобы диспетчер мог разобраться.
 *
 * ПОЧЕМУ БЕЗ «ЗАПИСЬ СОХРАНЕНА». Этот разбор обслуживает и ЧТЕНИЕ — загрузку
 * состояния смены (`fetchState`) и вопросов проверки знаний, — где никакой
 * записи не сохраняется, и обещание повтора там вводило бы в заблуждение
 * (F-V1-STATE-5XX-TEXT). Добавку про сохранённую запись несёт только путь
 * очереди, где она правдива: `withQueuedFailureNote` в `sendCommand`.
 */
function unparsedFailureText(status: number): string {
  if (status >= 500) {
    return `Сервер временно недоступен (код ${status}).`;
  }
  if (status >= 400) {
    return `Сервер отказал (код ${status}). Обновите экран и повторите.`;
  }
  return 'Сервер не ответил';
}

/** Точный текст схемы маршрута команд на несоответствие форме (`command/route.ts:196`). */
const BAD_COMMAND_TEXT_FROM_SERVER = 'Некорректная команда';

/**
 * Что показать вместо «Некорректная команда» (аудит R76, находка 25).
 *
 * Так отвечает схема маршрута на любое несоответствие команды форме — то есть
 * на рассогласование приложения и сервера, а не на ошибку машиниста. Прежняя
 * фраза не говорила, что делать. `details` этой ошибки — разбор схемы (zod
 * issues), машинисту их показывать нельзя: их отсекает `operatorErrorDetails`.
 */
const BAD_COMMAND_HINT =
  'Не удалось отправить — обновите экран и повторите. Если повторяется, сообщите администратору.';

/**
 * Отказ сервера → `ApiError` с понятным машинисту текстом. Общий разбор для
 * команд, чтения состояния, вопросов проверки знаний и получения ссылки на
 * снимок.
 *
 * ПОЧЕМУ ОБЩИЙ. Поток снимка разбирал ответ сам и отдавал в интерфейс СЫРУЮ
 * английскую строку сервера — «CSRF validation failed: origin mismatch» или
 * «Unauthorized» (аудит R89, находка 2). Те же правила, что у прочих запросов,
 * убирают её из формы снимка.
 *
 * `csrfMessage` — что сказать про 403 CSRF: у команды в очереди обещание
 * «запись сохранена на телефоне» правдиво, у команды-перехода и снимка — нет
 * (аудит R89, находка 1). `fallback` — общая фраза, когда сервер не дал
 * понятного текста. `russianOnly` — брать текст сервера только с кириллицей:
 * тело маршрута медиа приносит служебные английские строки, а машинисту они
 * ничего не говорят.
 */
function rejectionError(
  status: number,
  payload: {error?: unknown; details?: unknown} | null,
  options: {csrfMessage: string; fallback: string; russianOnly?: boolean},
): ApiError {
  const serverText = typeof payload?.error === 'string' ? payload.error : null;
  // Отказ CSRF-проверки приходит английской строкой (`csrf-protection.ts`:
  // `CSRF validation failed: …`) при расхождении `Origin` и `Host` — так
  // бывает, когда приложение открыто по IP, через прокси или вкладка
  // пережила смену адреса. Машинисту нужен русский выход «обновите
  // страницу», а не английская строка, и признак `reason`, по которому
  // очередь оставит запись `PENDING` (аудит R76, находка 12).
  if (status === 403 && serverText !== null && serverText.startsWith('CSRF validation failed')) {
    return new ApiError(403, options.csrfMessage, payload?.details, 'csrf');
  }
  if (serverText !== null && (!options.russianOnly || isHumanRussianText(serverText))) {
    return new ApiError(status,
      serverText === BAD_COMMAND_TEXT_FROM_SERVER ? BAD_COMMAND_HINT : serverText, payload?.details);
  }
  return new ApiError(status, options.fallback, payload?.details);
}

async function parse<T>(response: Response, csrfMessage = CSRF_REJECT_MESSAGE): Promise<T> {
  const payload = await response.json().catch(() => null) as
    {data?: T; error?: string; details?: unknown} | null;
  if (!response.ok) {
    throw rejectionError(response.status, payload, {
      csrfMessage,
      fallback: unparsedFailureText(response.status),
    });
  }
  // Успех — только разобранный ответ нашего сервера. Сеть гостиницы или
  // оператора связи отдаёт на перехваченный запрос свою страницу входа со
  // статусом 200: раньше это считалось успехом, запись уходила из очереди, а
  // сервер её так и не видел. Статус 0 — «не ответ сервера», повторить позже.
  if (payload === null || typeof payload !== 'object') {
    throw new ApiError(0, 'Ответ пришёл не от сервера приложения — возможно, сеть требует входа (Wi‑Fi). Запись осталась на устройстве.');
  }
  // Признак нашего ответа — результат под полем `data`. Все маршруты, которые
  // зовёт этот разбор (`command`, `state`, `knowledge-attempt`), кладут его
  // туда; чужой JSON поля `data` не имеет. Статус 0 → `classifyFailure` считает
  // сбой временным: запись остаётся `PENDING` и уйдёт повтором, а не снимется
  // с устройства (аудит R76, находка 14).
  if (!('data' in payload)) {
    throw new ApiError(0, NOT_SERVER_JSON);
  }
  return payload.data as T;
}

/**
 * Таймауты запросов к серверу (аудит R76, находка 13).
 *
 * ПОЧЕМУ ТАЙМАУТ. «Повисшее» соединение на мобильной сети не завершает `fetch`.
 * У очереди один `inFlight` на всю отправку (`offline-queue.ts`), и снимается
 * он только по завершению промиса: пока запрос висит, таймер, событие `online`,
 * «Повторить» и «Отправить записи с телефона» возвращают тот же незавершённый
 * промис и ничего не шлют до перезагрузки страницы, а кнопка остаётся в
 * «Записываем…». Истёкший таймаут — это сетевой сбой: запись остаётся `PENDING`
 * и уйдёт повтором (сервер узнаёт команду по `clientCommandId`).
 *
 * ПОЧЕМУ У ЗАГРУЗКИ ФАЙЛА БОЛЬШЕ. Файл снимка идёт напрямую в хранилище, и на
 * медленной сети большое фото грузится дольше 20 с: командам и чтению состояния
 * (короткий JSON-ответ) хватает 20 с, а снимку нужно больше.
 */
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** Сигнал запроса и снятие его следов (таймер, подписка на внешний сигнал). */
interface RequestSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

/**
 * Причина таймаута — `DOMException` «TimeoutError», её `operatorErrorText` знает
 * как обрыв связи. Если конструктор с именем недоступен, обрываем без причины:
 * тогда `fetch` отдаёт `AbortError`, который обрабатывается так же.
 */
function timeoutReason(): DOMException | undefined {
  try {
    return new DOMException('Timeout', 'TimeoutError');
  } catch {
    return undefined;
  }
}

/**
 * Сигнал таймаута запроса. Внешний сигнал (отмена при уходе с экрана) сохраняем:
 * запрос обрывается по тому, что наступит раньше.
 *
 * ПОЧЕМУ НЕ ТОЛЬКО `AbortSignal.timeout`/`AbortSignal.any`. `any` появился лишь
 * в Safari 17.4 / Chrome 116, а цели Next по умолчанию — Safari 16.4 / Chrome
 * 111, и полифилла у проекта нет. На iPhone с iOS 16.x–17.3 вызов
 * `AbortSignal.any` бросал бы `TypeError` синхронно, и любой запрос с внешним
 * сигналом падал бы всегда — машинист навсегда оставался на «Нет связи». Когда
 * родных помощников нет, собираем сигнал сами на `AbortController`.
 *
 * Таймер и подписка на внешний сигнал не должны жить дольше запроса, поэтому
 * помощник отдаёт вместе с сигналом функцию очистки — каждый запрос зовёт её в
 * `finally`. Без этого на длинном файле снимка (120 с) висел бы лишний таймер, а
 * в тестах — фейковое время.
 */
function timeoutSignal(ms: number, external?: AbortSignal): RequestSignal {
  const hasNativeTimeout = typeof AbortSignal.timeout === 'function';
  const hasNativeAny = typeof AbortSignal.any === 'function';
  if (hasNativeTimeout && (!external || hasNativeAny)) {
    const timeout = AbortSignal.timeout(ms);
    return {
      signal: external ? AbortSignal.any([external, timeout]) : timeout,
      cleanup: () => {},
    };
  }

  const controller = new AbortController();
  const reason = timeoutReason();
  const timer = setTimeout(() => {
    if (reason) controller.abort(reason);
    else controller.abort();
  }, ms);
  const onExternalAbort = () => {
    if (external) controller.abort(external.reason);
  };
  if (external) {
    // Уже отменённый внешний сигнал не прислал бы событие — обрываем сразу.
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onExternalAbort, {once: true});
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

export async function fetchState(input: {
  coordinates?: {latitude: number; longitude: number} | null;
  equipmentId?: string;
  /** Отмена при уходе с экрана: запрос обрывается тем, что наступит раньше. */
  signal?: AbortSignal;
}): Promise<OperatorMobileState> {
  const query = new URLSearchParams();
  if (input.coordinates) {
    query.set('lat', String(input.coordinates.latitude));
    query.set('lon', String(input.coordinates.longitude));
  }
  if (input.equipmentId) query.set('equipmentId', input.equipmentId);

  const timeout = timeoutSignal(REQUEST_TIMEOUT_MS, input.signal);
  try {
    const response = await fetch(`/api/operator/mobile/state?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: timeout.signal,
    });
    return await parse<OperatorMobileState>(response);
  } finally {
    timeout.cleanup();
  }
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
  const timeout = timeoutSignal(REQUEST_TIMEOUT_MS, signal);
  try {
    const response = await fetch('/api/operator/knowledge-attempt', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: timeout.signal,
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
  } finally {
    timeout.cleanup();
  }
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
  // Простой — часы (решение владельца 07.10.2026), без привязки ко времени работы.
  | {kind: 'DOWNTIME'; reasonId: string; hours: number; comment?: string};

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
 *
 * Третий повод — `server` (аудит R89, находка 4): сервер ОТВЕТИЛ отказом
 * (503/429/500 и прочие временные статусы), значит связь есть, а ждать надо не
 * её. Уведомление «сохранено на устройстве, отправим при связи» отправляло
 * машиниста искать связь при живом сервере — для этого повода текст другой.
 * Экран ведёт `server` как `network` (форма закрывается, уведомление с текстом).
 */
export class QueuedOffline extends Error {
  readonly reason: 'auth' | 'network' | 'server';

  constructor(readonly label: string, when: 'при связи' | 'после входа' | 'сервер' = 'при связи') {
    super(when === 'сервер'
      ? `${label}: сервер не принял запись, повторим автоматически`
      : `${label}: сохранено на устройстве, отправим ${when}`);
    this.name = 'QueuedOffline';
    this.reason = when === 'после входа' ? 'auth' : when === 'сервер' ? 'server' : 'network';
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
  const timeout = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/operator/mobile/command', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'same-origin',
      body: JSON.stringify(command),
      signal: timeout.signal,
    });
    // Команда-переход (`close-shift`, `finish-work` и прочие неочередные) в
    // очередь не попадает: при CSRF-отказе обещать «запись сохранена на
    // телефоне и уйдёт после обновления» было бы ложью — сохранять нечего, а
    // после обновления действие придётся повторить (аудит R89, находка 1).
    return await parse<T>(response,
      isQueueable(command) ? CSRF_REJECT_MESSAGE : CSRF_REJECT_NOT_QUEUED_MESSAGE);
  } finally {
    timeout.cleanup();
  }
}

/**
 * Дополнение к отказу сервера у команды, которая уже легла в очередь.
 *
 * ПОЧЕМУ ТОЛЬКО ЗДЕСЬ. Общий текст 5xx (`unparsedFailureText`) обслуживает и
 * чтение состояния смены, и вопросы проверки знаний, где никакой записи не
 * сохраняется, — там «Запись сохранена — отправим автоматически» обещало бы
 * то, чего нет (F-V1-STATE-5XX-TEXT). Здесь же команда действительно лежит на
 * устройстве и уйдёт повтором, поэтому обещание правдиво и вводит его только
 * путь очереди. Разбор тела ответа не повторяем: берём готовый текст ошибки.
 */
const QUEUED_FAILURE_NOTE = ' Запись сохранена — отправим автоматически.';

function withQueuedFailureNote(error: unknown): unknown {
  if (!(error instanceof ApiError) || error.status < 500) return error;
  return new ApiError(error.status, `${error.message}${QUEUED_FAILURE_NOTE}`, error.details, error.reason);
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
  // Состав записи на момент отправки. Если за время ответа машинист исправит
  // форму и положит тем же ключом новый состав (`enqueue` обновит `queuedAt`),
  // поздний результат относится к прежнему и трогать новую запись нельзя
  // (F-V1-QUEUE-VERSION).
  const queuedAt = readQueue().find((item) => item.clientCommandId === command.clientCommandId)?.queuedAt;
  try {
    const result = await postCommand<T>(command);
    resolve(command.clientCommandId, queuedAt);
    return result;
  } catch (caught) {
    // Отказ сервера у команды из очереди: 5xx дополняем обещанием повтора —
    // запись правда на устройстве и уйдёт сама (F-V1-STATE-5XX-TEXT). Текст
    // попадёт и машинисту в плашку очереди через `markAttempt`, и в решение о
    // судьбе записи ниже.
    const error = withQueuedFailureNote(caught);
    // CSRF-403 — временный отказ, хотя и 403: причина (расхождение `Origin` и
    // `Host`) снимается перезагрузкой страницы. Запись остаётся `PENDING` и
    // уйдёт сама, а машинист читает русское указание (`ApiError.message`).
    // Прочие 403 (роль, чужая смена) остаются `permanent`, как раньше
    // (аудит R76, находка 12).
    if (isCsrfFailure(error)) {
      markAttempt(command.clientCommandId,
        error instanceof Error ? error.message : CSRF_REJECT_MESSAGE, false, queuedAt);
      throw error;
    }
    const kind = classifyFailure(error instanceof ApiError ? error.status : null);
    if (kind === 'permanent') {
      // Не удаляем: запись остаётся видимой машинисту с составом и причиной,
      // а убрать её он может сам через `discard` (R82, находка 1).
      markAttempt(command.clientCommandId,
        error instanceof Error ? error.message : 'Сервер отклонил запись', true, queuedAt);
      throw error;
    }
    markAttempt(command.clientCommandId,
      kind === 'auth' ? AUTH_WAIT_MESSAGE : error instanceof Error ? error.message : 'Не отправлено',
      false, queuedAt);
    // Сервер ответил отказом (есть HTTP-статус) — связь есть, дело в сервере:
    // уведомление не должно отправлять машиниста искать связь (аудит R89,
    // находка 4). Без статуса (обрыв сети, таймаут) — прежний повод.
    const serverRefused = error instanceof ApiError && error.status >= 400;
    throw new QueuedOffline(commandLabel(command),
      kind === 'auth' ? 'после входа' : serverRefused ? 'сервер' : 'при связи');
  }
}

/**
 * Текст отказа хранилища на PUT файла снимка (аудит R76, находка 24).
 *
 * Тело отказа хранилища — XML, разбирать его незачем, а решать по нему надо.
 * Прежняя общая фраза «Снимок не загрузился» не давала выбора между повтором и
 * пересъёмкой: 403 — «ссылка истекла, нужна новая» (повторять), 413 — «файл
 * велик, снимайте с меньшим качеством» (переснимать), 5xx — «хранилище
 * недоступно, повторите позже» (ждать). Прочие коды машинисту ни о чём не
 * говорят — называем код, чтобы диспетчер мог разобраться.
 */
function uploadRejectionText(status: number): string {
  if (status === 403) return 'Ссылка для загрузки устарела. Повторите — получим новую.';
  if (status === 413) return 'Снимок слишком большой. Сделайте фото заново с меньшим качеством.';
  if (status >= 500) return 'Хранилище временно недоступно. Повторите позже.';
  return `Снимок не загрузился (код ${status}).`;
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
  const grantTimeout = timeoutSignal(REQUEST_TIMEOUT_MS);
  try {
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
      signal: grantTimeout.signal,
    });
    // Медиа-маршрут отвечает объектом напрямую, без обёртки `data`, поэтому
    // разбираем его сами, но ОТКАЗ разбираем общими правилами: раньше сюда
    // попадала сырая английская строка сервера — «CSRF validation failed:
    // origin mismatch» или «Unauthorized» (аудит R89, находка 2). Снимок в
    // очередь не попадает, поэтому у CSRF-отказа текст без обещания
    // сохранения, а некириллический отказ заменяется общей фразой.
    const granted = await grant.json().catch(() => null) as
      {mediaId?: string; uploadUrl?: string; error?: string} | null;
    if (!grant.ok) {
      throw rejectionError(grant.status, granted, {
        csrfMessage: CSRF_REJECT_NOT_QUEUED_MESSAGE,
        fallback: 'Не удалось получить ссылку для снимка',
        russianOnly: true,
      });
    }
    if (!granted?.mediaId || !granted.uploadUrl) {
      throw new ApiError(grant.status, 'Не удалось получить ссылку для снимка');
    }
    const {mediaId, uploadUrl} = granted;

    const storedTimeout = timeoutSignal(UPLOAD_TIMEOUT_MS);
    try {
      const stored = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {'Content-Type': input.file.type || 'image/jpeg'},
        body: input.file,
        signal: storedTimeout.signal,
      });
      if (!stored.ok) throw new ApiError(stored.status, uploadRejectionText(stored.status));
    } finally {
      storedTimeout.cleanup();
    }

    const confirmTimeout = timeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const confirmed = await fetch(`/api/media/${mediaId}/confirm`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: confirmTimeout.signal,
      });
      // Отказ по существу сервер объясняет сам: 422 «Загруженный файл пуст или
      // недоступен» / «Содержимое файла не соответствует заявленному типу…»
      // (`media-service.ts:244,268-271`). Раньше любой ответ подменялся общей фразой,
      // и машинист жал то же битое фото снова вместо того, чтобы снять заново.
      // Разбираем тело тем же способом, что и отказ на первом шаге — запросе
      // ссылки (`rejectionError`): понятный
      // русский текст из поля `error` показываем, иначе (не JSON, чужая/английская
      // строка) — общую фразу (аудит R76, находка 11).
      if (!confirmed.ok) {
        const body = await confirmed.json().catch(() => null) as {error?: string} | null;
        const reason = isHumanRussianText(body?.error)
          ? body?.error
          : 'Снимок не подтверждён сервером';
        throw new ApiError(confirmed.status, reason);
      }
    } finally {
      confirmTimeout.cleanup();
    }

    return mediaId;
  } finally {
    grantTimeout.cleanup();
  }
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
