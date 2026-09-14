/**
 * Матрица допусков работника к технике: чтение и правка.
 *
 * ЧТО ЭТО ЗА ВОПРОС. Допуск по документам («есть ли у человека действующий
 * медосмотр») отвечает, можно ли ему работать ВООБЩЕ. Матрица отвечает на
 * другой: на чём именно и что делать. Машинист с полным комплектом бумаг
 * может не иметь допуска к буровой — это не нарушение, а нормальное
 * состояние, и до появления матрицы система такого различия не знала.
 *
 * МАТРИЦА НЕ УЧАСТВУЕТ В ПУСКЕ СМЕНЫ. Пока — сознательно: допуск к смене
 * держат обязательные документы и блокировки контура готовности, и вводить
 * третью систему запретов одним заходом нельзя. Сначала матрица должна
 * наполниться живыми данными; включение её в расчёт — отдельное решение
 * владельца, а не побочный эффект появления таблицы.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type {
  EquipmentKind, EquipmentPermitStatus, EquipmentWorkScope,
} from '@/generated/postgres-client/client';

export interface EquipmentPermitRow {
  id: string;
  equipmentKind: EquipmentKind;
  equipmentModel: string;
  scope: EquipmentWorkScope;
  status: EquipmentPermitStatus;
  restriction: string;
  validUntil: string | null;
  notes: string;
  grantedByName: string;
  /** Срок вышел. Просроченный допуск — не допуск, и показывать его зелёным нельзя. */
  expired: boolean;
}

export interface EquipmentPermitInput {
  equipmentKind: EquipmentKind;
  equipmentModel?: string;
  scope: EquipmentWorkScope;
  status: EquipmentPermitStatus;
  restriction?: string;
  validUntil?: Date | null;
  notes?: string;
}

/**
 * Матрица одного работника.
 *
 * Право приходит аргументом: прикладную матрицу прав модулю знать нельзя,
 * решение принимает маршрут — тот же приём, что в журнале и сводке. Свои
 * допуски работник видит без права, как и свои документы.
 */
export async function listEquipmentPermits(input: {
  tenantId: string;
  userId: string;
  /** true, если спрашивает сам работник либо у него `users.documents.read_all`. */
  mayRead: boolean;
  now?: Date;
}): Promise<EquipmentPermitRow[]> {
  if (!input.mayRead) {
    throw new ServiceError('Недостаточно прав для просмотра допусков к технике', 403);
  }
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const now = input.now ?? new Date();
  const rows = await db.userEquipmentPermit.findMany({
    where: { tenantId: input.tenantId, userId: input.userId },
    orderBy: [{ equipmentKind: 'asc' }, { equipmentModel: 'asc' }, { scope: 'asc' }],
  });

  return rows.map((row) => ({
    id: row.id,
    equipmentKind: row.equipmentKind,
    equipmentModel: row.equipmentModel,
    scope: row.scope,
    status: row.status,
    restriction: row.restriction,
    validUntil: row.validUntil?.toISOString() ?? null,
    notes: row.notes,
    grantedByName: row.grantedByName,
    expired: row.validUntil != null && row.validUntil.getTime() < now.getTime(),
  }));
}

function assertPayload(payload: EquipmentPermitInput) {
  // «Ограничен» без объяснения нечитаем: через полгода никто не вспомнит, чем
  // именно, и строка превратится в непонятный жёлтый значок.
  if (payload.status === 'LIMITED' && !payload.restriction?.trim()) {
    throw new ServiceError('Для ограниченного допуска укажите, чем он ограничен', 400);
  }
  // Допуск, выданный уже просроченным, — это не допуск, а опечатка в дате.
  if (payload.validUntil && payload.validUntil.getTime() < Date.now()) {
    throw new ServiceError('Срок действия допуска уже истёк — проверьте дату', 400);
  }
}

/**
 * Завести или обновить строку матрицы.
 *
 * Одна строка на сочетание «работник × вид техники × модель × вид работ»:
 * второй допуск на то же сочетание — не история, а спор о том, какой из них
 * действует. Поэтому повторная выдача ПЕРЕЗАПИСЫВАЕТ строку, а не множит её.
 */
export async function upsertEquipmentPermit(input: {
  tenantId: string;
  userId: string;
  actor: { id: string; name: string };
  /** `users.manage` — заводить чужие допуски может только администратор. */
  mayManage: boolean;
  payload: EquipmentPermitInput;
}) {
  if (!input.mayManage) {
    throw new ServiceError('Недостаточно прав для выдачи допуска к технике', 403);
  }
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);
  assertPayload(input.payload);

  // Работник обязан быть из своей организации: иначе строка ляжет на чужого
  // человека под нашим tenantId.
  const employee = await db.user.findFirst({
    where: { id: input.userId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!employee) throw new ServiceError('Работник не найден', 404);

  const model = input.payload.equipmentModel?.trim() ?? '';
  const data = {
    status: input.payload.status,
    restriction: input.payload.restriction?.trim() ?? '',
    validUntil: input.payload.validUntil ?? null,
    notes: input.payload.notes?.trim() ?? '',
    grantedById: input.actor.id,
    grantedByName: input.actor.name,
  };

  return db.userEquipmentPermit.upsert({
    where: {
      tenantId_userId_equipmentKind_equipmentModel_scope: {
        tenantId: input.tenantId,
        userId: employee.id,
        equipmentKind: input.payload.equipmentKind,
        equipmentModel: model,
        scope: input.payload.scope,
      },
    },
    create: {
      tenantId: input.tenantId,
      userId: employee.id,
      equipmentKind: input.payload.equipmentKind,
      equipmentModel: model,
      scope: input.payload.scope,
      ...data,
    },
    update: data,
    select: { id: true },
  });
}

/**
 * Убрать строку матрицы.
 *
 * Удаление, а не «признать недействующей»: строка матрицы — это СОСТОЯНИЕ,
 * а не документ. Ошибочно заведённый допуск нужно убрать, а окончившийся сам
 * показывается просроченным по сроку.
 */
export async function deleteEquipmentPermit(input: {
  tenantId: string;
  permitId: string;
  mayManage: boolean;
}) {
  if (!input.mayManage) {
    throw new ServiceError('Недостаточно прав для удаления допуска', 403);
  }
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  // Сужение по тенанту в самом условии удаления, а не проверкой до него:
  // между проверкой и удалением строка успевает смениться.
  const removed = await db.userEquipmentPermit.deleteMany({
    where: { id: input.permitId, tenantId: input.tenantId },
  });
  if (removed.count === 0) throw new ServiceError('Допуск не найден', 404);
}
