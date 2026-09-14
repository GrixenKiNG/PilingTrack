/**
 * Общая оснастка команд смены: то, чем пользуются несколько обязанностей.
 *
 * Сюда попадает помощник, нужный больше чем одному файлу, — и только он.
 * Помощник с единственным вызывающим живёт рядом с ним, а не здесь: общий
 * модуль, куда складывают всё подряд, через полгода не отличим от того
 * файла на 1728 строк, из которого этот набор и вырезан.
 *
 * recordMeter нужен и приёмке техники, и осмотру; ensureReport — и выработке,
 * и закрытию смены. Поэтому они здесь, а не в своих модулях.
 */
import type {Prisma} from '@/generated/postgres-client/client';
import {type ChecklistAnswer} from '../../domain/checklist-run';


export class OperatorCommandError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'OperatorCommandError';
  }
}

export type Tx = Prisma.TransactionClient;

export const DAY_MS = 86_400_000;

export async function requireCrew(tx: Tx, tenantId: string, operatorId: string, equipmentId: string) {
  const crew = await tx.crew.findFirst({
    where: {operatorId, equipmentId, isActive: true, equipment: {tenantId}},
    select: {
      id: true, siteId: true,
      equipment: {select: {isActive: true, hammerKind: true, isCombined: true}},
    },
  });
  if (!crew) throw new OperatorCommandError(403, 'Эта установка за вами не закреплена');
  return crew;
}

export async function requireOpenShift(tx: Tx, tenantId: string, shiftId: string) {
  const shift = await tx.shift.findFirst({
    where: {tenantId, id: shiftId},
    select: {id: true, state: true, equipmentId: true, productionDate: true, type: true},
  });
  if (!shift) throw new OperatorCommandError(404, 'Смена не найдена');
  if (shift.state === 'CLOSED' || shift.state === 'CANCELLED') {
    throw new OperatorCommandError(409, 'Смена уже закрыта');
  }
  return shift;
}

/** Производственные сутки в поясе оператора. */
export function productionDateOf(timezone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}


/**
 * Моточасы: журнал показаний — источник истины, поле в карточке техники —
 * денормализованный кэш последнего значения. Обновляем оба, иначе списки
 * техники показывают вчерашнюю наработку.
 */
export async function recordMeter(tx: Tx, input: {
  tenantId: string; equipmentId: string; engineHours: number;
  operatorId: string; note: string; now: Date;
}) {
  const previous = await tx.meterReading.findFirst({
    where: {tenantId: input.tenantId, equipmentId: input.equipmentId},
    orderBy: {recordedAt: 'desc'},
    select: {engineHours: true},
  });
  // Счётчик моточасов не крутится назад. Меньшее значение — опечатка, и
  // принять её значит испортить и наработку, и планы ТО, которые от неё зависят.
  if (previous && input.engineHours < previous.engineHours) {
    throw new OperatorCommandError(
      400,
      `Моточасы меньше предыдущего показания (${previous.engineHours}). Проверьте цифру.`,
    );
  }

  await tx.meterReading.create({
    data: {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      recordedAt: input.now,
      engineHours: input.engineHours,
      source: 'MANUAL',
      recordedById: input.operatorId,
      note: input.note,
    },
  });
  await tx.equipment.update({
    where: {tenantId_id: {tenantId: input.tenantId, id: input.equipmentId}},
    data: {engineHoursTotal: input.engineHours},
  });
}


export type EvidenceKind = 'KNOWLEDGE_TEST' | 'WEATHER_SNAPSHOT' | 'SITE_CHECK' | 'STARTUP_READING'
  | 'MAINTENANCE_ACTION' | 'FLUID_READING' | 'PILE_DRIVING' | 'LEADER_DRILLING';

export async function recordEvidence(tx: Tx, input: {
  tenantId: string; shiftId: string; equipmentId: string; kind: EvidenceKind;
  payload: Prisma.InputJsonValue; operatorId: string; clientCommandId: string; now: Date;
}) {
  const existing = await tx.operatorShiftEvidence.findUnique({
    where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
    select: {id: true},
  });
  if (existing) return;
  await tx.operatorShiftEvidence.create({
    data: {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      equipmentId: input.equipmentId,
      kind: input.kind,
      payload: input.payload,
      occurredAt: input.now,
      recordedById: input.operatorId,
      clientCommandId: input.clientCommandId,
    },
  });
}

/**
 * Фотографии пунктов осмотра: проверка, что снимок действительно загружен.
 *
 * Телефон присылает список идентификаторов, но сам по себе он ничего не
 * доказывает: снимок мог не долететь в хранилище, мог принадлежать другому
 * человеку либо оказаться не изображением. Правило «неисправность требует
 * фотографии» имеет смысл, только если фотография проверена здесь.
 */
export async function requireConfirmedImages(
  tx: Tx, tenantId: string, actorId: string, clientCommandId: string, answers: ChecklistAnswer[],
) {
  const expected = answers.flatMap((answer) => (answer.mediaIds ?? []).map((mediaId) => ({
    mediaId, entityId: `${clientCommandId}:${answer.itemId}`,
  })));
  if (expected.length === 0) return;

  const confirmed = await tx.media.findMany({
    where: {
      id: {in: expected.map((item) => item.mediaId)},
      tenantId,
      userId: actorId,
      entityType: 'equipment_defect',
      uploadStatus: 'completed',
      isDeleted: false,
    },
    select: {id: true, entityId: true, contentType: true},
  });

  const valid = new Set(
    confirmed
      .filter((media) => media.contentType.startsWith('image/'))
      .filter((media) => expected.some(
        (item) => item.mediaId === media.id && item.entityId === media.entityId,
      ))
      .map((media) => media.id),
  );
  if (valid.size !== new Set(expected.map((item) => item.mediaId)).size) {
    throw new OperatorCommandError(409, 'Фотография не загрузилась. Снимите заново.');
  }
}


/** Отчёт смены — один на смену. Создаётся при первой записи выработки. */
export async function ensureReport(tx: Tx, input: {
  tenantId: string; shiftId: string; operatorId: string; siteId: string;
  equipmentId: string; crewId: string; productionDate: string; shiftType: string;
}) {
  const existing = await tx.report.findFirst({
    where: {tenantId: input.tenantId, shiftId: input.shiftId},
    select: {id: true},
  });
  if (existing) return existing.id;

  const created = await tx.report.create({
    data: {
      tenantId: input.tenantId,
      reportId: `RM-${input.shiftId.slice(0, 8)}-${input.productionDate}`,
      userId: input.operatorId,
      crewId: input.crewId,
      equipmentId: input.equipmentId,
      siteId: input.siteId,
      date: input.productionDate,
      shiftType: input.shiftType,
      status: 'draft',
      shiftId: input.shiftId,
      lastEditedById: input.operatorId,
    },
    select: {id: true},
  });
  return created.id;
}

