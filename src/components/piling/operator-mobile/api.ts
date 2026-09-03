'use client';

import type {
  ChecklistAnswer, ChecklistStage, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';

/**
 * Клиент мобильного места. Только онлайн: очереди и хранилища на телефоне нет.
 *
 * ПОЧЕМУ БЕЗ ОЧЕРЕДИ. Автономная работа — это отдельный продукт со своими
 * правилами разрешения конфликтов. Пока её нет, честнее показать «нет сети»,
 * чем принять осмотр, который неизвестно когда доедет до сервера и доедет ли.
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

export type ProductionEntryInput =
  | {kind: 'PILES'; pileGradeId: string; count: number; comment?: string}
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

export async function sendCommand<T = unknown>(command: Command): Promise<T> {
  const response = await fetch('/api/operator/mobile/command', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify(command),
  });
  return parse<T>(response);
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
