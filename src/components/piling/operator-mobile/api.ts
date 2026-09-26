'use client';

import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
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
 */
export class QueuedOffline extends Error {
  constructor(readonly label: string, when: 'при связи' | 'после входа' = 'при связи') {
    super(`${label}: сохранено на устройстве, отправим ${when}`);
    this.name = 'QueuedOffline';
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
  // введённое. Успех снимает запись из очереди, отказ по существу — тоже
  // (повтор не поможет, а форма с цифрами ещё открыта), а обрыв, «слишком
  // часто» и истёкший вход оставляют её ждать.
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
      resolve(command.clientCommandId);
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
