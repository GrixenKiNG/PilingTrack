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
import {checkOperatorDocuments} from '../../domain/operator-admission';
import {BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE} from '../../domain/operator-credentials';
import {productionRefusal, productionBlocks} from '../../domain/production-permit';


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

/**
 * Открытая смена ЭТОГО машиниста.
 *
 * СМЕНЩИКОВ НЕТ (решение владельца 24.09.2026): смену от приёмки до сдачи
 * ведёт один человек. Закрепление бригады (requireCrew) это не гарантирует —
 * установку переназначают, и новый машинист дописывал бы сваи в чужую смену,
 * а они ложились бы в отчёт прежнего. Смена чужая, если её запустил другой
 * машинист или по ней уже ведётся отчёт другого человека. Смену, запущенную
 * диспетчером или администратором, машинист ведёт сам — это не чужая.
 */
export async function requireOpenShift(tx: Tx, tenantId: string, shiftId: string, operatorId: string) {
  const shift = await tx.shift.findFirst({
    where: {tenantId, id: shiftId},
    select: {
      id: true, state: true, equipmentId: true, productionDate: true, type: true,
      starter: {select: {id: true, role: true}},
    },
  });
  if (!shift) throw new OperatorCommandError(404, 'Смена не найдена');
  if (shift.state === 'CLOSED' || shift.state === 'CANCELLED') {
    throw new OperatorCommandError(409, 'Смена уже закрыта');
  }

  const startedByOtherOperator = shift.starter?.role === 'OPERATOR' && shift.starter.id !== operatorId;
  const report = startedByOtherOperator
    ? null
    : await tx.report.findFirst({where: {tenantId, shiftId}, select: {userId: true}});
  if (startedByOtherOperator || (report && report.userId !== operatorId)) {
    throw new OperatorCommandError(403, 'Эту смену ведёт другой машинист');
  }

  const {starter: _starter, ...rest} = shift;
  return rest;
}

/** Производственные сутки в поясе оператора. */
export function productionDateOf(timezone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}


/**
 * Запись справочника — ТОЛЬКО СВОЕЙ ОРГАНИЗАЦИИ.
 *
 * ЗАЧЕМ ЭТО ЕСТЬ. Марка сваи, тип бурения и причина простоя приходят с
 * телефона идентификатором, и до этой проверки он писался в отчёт как есть.
 * Оператор одной организации мог прислать `pileGradeId` чужой — сервер
 * отвечал 200 и записывал чужую марку в свою выработку. Ломалось при этом не
 * только разграничение: длина сваи берётся из её марки, чужая марка в расчёте
 * не разрешалась, и пять двенадцатиметровых свай давали 48 метров вместо 60.
 * То есть утечка границы сразу портила и цифры в отчёте.
 *
 * Закрепление за установкой при этом проверялось правильно (чужая машина
 * отвергалась с 403) — и именно поэтому дыра дожила до аудита: одна закрытая
 * граница выглядит как закрытые все.
 *
 * Проверка ПО ЗАПИСИ, а не по фильтру в основном запросе: `findFirst` с чужим
 * идентификатором вернул бы `null`, и вместо отказа получилась бы запись с
 * пустым полем. Нет записи — отказ с именем справочника.
 */
async function requireDictionaryRow<T>(
  find: () => Promise<T | null>,
  message: string,
): Promise<T> {
  const row = await find();
  if (!row) throw new OperatorCommandError(400, message);
  return row;
}

export function requirePileGrade(tx: Tx, tenantId: string, id: string) {
  return requireDictionaryRow(
    () => tx.pileGrade.findFirst({
      where: {tenantId, id, isActive: true},
      select: {id: true, lengthMm: true},
    }),
    'Марка сваи не найдена в справочнике вашей организации',
  );
}

export function requireDrillingType(tx: Tx, tenantId: string, id: string) {
  return requireDictionaryRow(
    () => tx.drillingType.findFirst({
      where: {tenantId, id, isActive: true},
      select: {id: true},
    }),
    'Тип бурения не найден в справочнике вашей организации',
  );
}

export function requireDowntimeReason(tx: Tx, tenantId: string, id: string) {
  return requireDictionaryRow(
    () => tx.downtimeReason.findFirst({
      where: {tenantId, id, isActive: true},
      select: {id: true},
    }),
    'Причина простоя не найдена в справочнике вашей организации',
  );
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
  /*
    СРАВНИВАЕМ С ОБОИМИ ИСТОЧНИКАМИ НАРАБОТКИ, А НЕ ТОЛЬКО С ЖУРНАЛОМ.

    Журнал показаний ведётся с момента, как машину начали снимать с телефона, а
    наработка в карточке установки есть с самого её заведения — её вносит
    администратор. У новой машины журнал ПУСТ, и проверка «меньше предыдущего»
    не срабатывала вовсе: в карточке стояло 100 м/ч, первый же послесменный
    ввод 99 проходил, и 99 уезжало и в карточку, и в закрытый отчёт. Наработка
    машины уменьшилась на глазах, а вместе с ней поехали планы ТО, которые от
    неё считаются.

    Берём максимум из двух: счётчик не крутится назад ни по одному из них.
  */
  const [previous, equipment] = await Promise.all([
    tx.meterReading.findFirst({
      where: {tenantId: input.tenantId, equipmentId: input.equipmentId},
      orderBy: {recordedAt: 'desc'},
      select: {engineHours: true},
    }),
    tx.equipment.findFirst({
      where: {tenantId: input.tenantId, id: input.equipmentId},
      select: {engineHoursTotal: true},
    }),
  ]);

  const known = [previous?.engineHours, equipment?.engineHoursTotal]
    .filter((value): value is number => typeof value === 'number');
  const floor = known.length > 0 ? Math.max(...known) : null;

  // Счётчик моточасов не крутится назад. Меньшее значение — опечатка, и
  // принять её значит испортить и наработку, и планы ТО, которые от неё зависят.
  if (floor !== null && input.engineHours < floor) {
    throw new OperatorCommandError(
      400,
      `Моточасы меньше известной наработки (${floor}). Проверьте цифру.`,
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


/**
 * Запрет на продолжение работы — проверяется СЕРВЕРОМ, перед записью выработки.
 *
 * ПОЧЕМУ НЕ ТОЛЬКО НА ЭКРАНЕ. Экран прячет кнопку, а прямой запрос к API её не
 * спрашивает. Ровно этим путём аудит и прошёл: просроченный документ рисовался
 * красным, а выработка записывалась. Запрет, который живёт в интерфейсе, —
 * это не запрет, а совет.
 *
 * ЧТО ИМЕННО ЗАКРЫВАЕТСЯ. Только выработка: сваи, паспорт сваи, бурение.
 * Простой, происшествие, дефект, осмотр, поправка, отчёт и закрытие смены
 * вызывают эту проверку намеренно НЕ — обоснование в `domain/production-permit.ts`.
 *
 * Запрос отдельный от экрана состояния и намеренно узкий: четыре выборки
 * вместо двадцати. Цена — четыре чтения на запись выработки; альтернатива —
 * повторить здесь весь сбор состояния смены и разойтись с ним на первой правке.
 */
export async function requireProductionPermit(tx: Tx, input: {
  tenantId: string; operatorId: string; equipmentId: string; shiftId: string;
  productionDate: Date; now: Date;
}) {
  const [types, documents, ppeCheck, defects, incidents, equipment] = await Promise.all([
    tx.userDocumentType.findMany({
      where: {tenantId: input.tenantId, isActive: true},
      select: {id: true, name: true, requiresExpiry: true, leadTimeDays: true, requiredForOperator: true},
    }),
    tx.userDocument.findMany({
      where: {tenantId: input.tenantId, userId: input.operatorId},
      select: {typeId: true, number: true, expiresAt: true},
    }),
    tx.ppeCheck.findFirst({
      where: {tenantId: input.tenantId, userId: input.operatorId, productionDate: input.productionDate},
      select: {missing: true},
    }),
    tx.equipmentDefect.findMany({
      where: {
        tenantId: input.tenantId, equipmentId: input.equipmentId,
        status: {in: ['OPEN', 'IN_WORK']}, severity: 'CRITICAL',
      },
      select: {title: true, severity: true},
    }),
    tx.safetyIncident.findMany({
      where: {
        tenantId: input.tenantId, shiftId: input.shiftId,
        reviewedAt: null, stopRequired: true,
      },
      select: {description: true, stopRequired: true},
    }),
    tx.equipment.findFirst({
      where: {tenantId: input.tenantId, id: input.equipmentId},
      select: {isActive: true},
    }),
  ]);

  // Инструктаж и проверка знаний — служебные виды документов: их состояние
  // держит фазу допуска, и второй раз как «просроченный документ» они
  // показываться не должны. Тот же фильтр стоит в запросе состояния.
  const visibleTypes = types.filter(
    (type) => type.name !== BRIEFING_DOCUMENT_TYPE && type.name !== KNOWLEDGE_DOCUMENT_TYPE,
  );

  const blocks = productionBlocks({
    documents: checkOperatorDocuments(visibleTypes, documents, input.now),
    ppeMissing: ppeCheck?.missing ?? [],
    openDefects: defects,
    openIncidents: incidents,
    equipmentActive: equipment?.isActive ?? true,
  });

  if (blocks.length > 0) {
    throw new OperatorCommandError(
      409,
      `Работа запрещена: ${productionRefusal(blocks)}`,
      {blocks},
    );
  }
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


/**
 * Отчёт смены — один на смену. Создаётся при первой записи выработки.
 *
 * ЗАВОДИТСЯ ЧЕРЕЗ `upsert` ПО КЛЮЧУ СМЕНЫ, А НЕ `findFirst`+`create`.
 * Заводит отчёт не только повтор команды: две вкладки, два устройства либо
 * слив очереди в момент, когда машинист пишет новую сваю, вызывают его
 * одновременно. При чтении с последующей вставкой проигравший падал на
 * уникальности отчёта и терял запись целиком: свая не записывалась, а сервер
 * отвечал 200 (находка F-R31-1). Конфликт разрешает база, одной операцией;
 * `update: {}` пуст — существующий отчёт не правится.
 *
 * КЛЮЧ — `@@unique([tenantId, shiftId])`, А НЕ `reportId`.
 * У одной смены отчёт может быть заведён и раньше, и другим путём: форма
 * отчёта (`report-command.service.ts`) пишет тот же `shiftId` со СВОИМ
 * `reportId`. Upsert по `reportId` такой отчёт не находил и шёл вставлять
 * второй — база отвергала вставку по `[tenantId, shiftId]`, ошибка
 * пробрасывалась наружу, и очередь машиниста застревала навсегда: ни записи
 * в отчёте, ни ответа, по которому клиент снял бы её с устройства.
 * Организация входит в ключ, поэтому чужой отчёт с тем же `shiftId` не
 * подхватится — отдельная сверка тенанта не нужна.
 */
export async function ensureReport(tx: Tx, input: {
  tenantId: string; shiftId: string; operatorId: string; siteId: string;
  equipmentId: string; crewId: string; productionDate: string; shiftType: string;
}) {
  const report = await tx.report.upsert({
    where: {tenantId_shiftId: {tenantId: input.tenantId, shiftId: input.shiftId}},
    create: {
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
    update: {},
    select: {id: true},
  });

  return report.id;
}

