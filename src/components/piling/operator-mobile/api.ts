'use client';

import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {commandLabel, enqueue, isQueueable, markAttempt, resolve} from './offline-queue';

/**
 * Клиент мобильного места.
 *
 * Добавляющие записи (выработка, осмотр, происшествие, поправка) переживают
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
  return payload?.data as T;
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

export interface PilePassportInput {
  pileNumber: string;
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
  | {kind: 'DOWNTIME'; reasonId: string; hours: number; comment?: string};

type Command =
  | {command: 'acknowledge-briefing'}
  | {command: 'submit-knowledge'; picks: {questionId: string; picked: number}[]}
  | {command: 'accept-equipment'; clientCommandId: string; equipmentId: string; shiftType: 'DAY' | 'NIGHT'}
  | {command: 'submit-checklist'; clientCommandId: string; shiftId: string; equipmentId: string; stage: ChecklistStage; answers: ChecklistAnswer[]}
  | {command: 'log-production'; clientCommandId: string; shiftId: string; entry: ProductionEntryInput}
  | {command: 'correct-production'; clientCommandId: string; shiftId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; entryId: string; actual: number; reason: string}
  | {command: 'report-incident'; clientCommandId: string; shiftId: string; category: string; signs: string[]; injured: boolean; description: string; mediaIds?: string[]}
  | {command: 'finish-work'; shiftId: string}
  | {command: 'close-shift'; shiftId: string; comment: string};

/**
 * Запись принята устройством, но ещё не сервером: лежит в очереди и уйдёт,
 * когда вернётся сеть. Не ошибка — форму можно закрывать, данные не потеряны.
 */
export class QueuedOffline extends Error {
  constructor(readonly label: string) {
    super(`${label}: сохранено на устройстве, отправим при связи`);
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
  // (повтор не поможет), а обрыв оставляет её ждать связи.
  enqueue(command);
  try {
    const result = await postCommand<T>(command);
    resolve(command.clientCommandId);
    return result;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : null;
    const permanent = status !== null && status >= 400 && status < 500;
    if (permanent) {
      resolve(command.clientCommandId);
      throw error;
    }
    markAttempt(command.clientCommandId,
      error instanceof Error ? error.message : 'Не отправлено', false);
    throw new QueuedOffline(commandLabel(command));
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
