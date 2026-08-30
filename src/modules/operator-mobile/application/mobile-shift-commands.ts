import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {getChecklist} from '../domain/checklist-catalog';
import type {ChecklistStage} from '../domain/checklist-types';
import {
  blockingFaults, collectDefectDrafts, validateChecklistRun, type ChecklistAnswer,
} from '../domain/checklist-run';
import {selectChecklistItems} from '../domain/shift-conditions';

/**
 * Команды мобильного места оператора.
 *
 * ПОЧЕМУ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ НА ТЕНАНТА. Строгие политики RLS на бою
 * пропускают запись только внутри транзакции с установленным
 * `app.current_tenant`. Общий помощник взят из модуля готовности намеренно:
 * второй способ открывать тенантную транзакцию означал бы второй набор правил
 * доступа, а их в продукте уже два и этого достаточно.
 *
 * ПОЧЕМУ clientCommandId. Сеть на площадке рвётся посреди запроса. Телефон
 * повторит отправку, и без ключа команды в журнале появится второй осмотр либо
 * вторая пачка свай. Ключ приходит с телефона и уникален в базе — повтор
 * возвращает прежний результат вместо дубля.
 */

export class OperatorCommandError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'OperatorCommandError';
  }
}

type Tx = Prisma.TransactionClient;

async function requireCrew(tx: Tx, tenantId: string, operatorId: string, equipmentId: string) {
  const crew = await tx.crew.findFirst({
    where: {operatorId, equipmentId, isActive: true, equipment: {tenantId}},
    select: {id: true, siteId: true, equipment: {select: {isActive: true, hammerKind: true, isCombined: true, model: true}}},
  });
  if (!crew) throw new OperatorCommandError(403, 'Эта установка за вами не закреплена');
  if (!crew.equipment.isActive) throw new OperatorCommandError(409, 'Установка выведена из эксплуатации');
  return crew;
}

async function requireOpenShift(tx: Tx, tenantId: string, shiftId: string) {
  const shift = await tx.shift.findFirst({
    where: {tenantId, id: shiftId},
    select: {id: true, state: true, equipmentId: true},
  });
  if (!shift) throw new OperatorCommandError(404, 'Смена не найдена');
  if (shift.state === 'CLOSED' || shift.state === 'CANCELLED') {
    throw new OperatorCommandError(409, 'Смена уже закрыта');
  }
  return shift;
}

/** Производственные сутки в поясе оператора. */
function productionDateOf(timezone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/**
 * Приём установки: оператор подтверждает машину и снимает моточасы.
 *
 * Это и есть открытие смены. Отдельной кнопки «открыть смену» нет намеренно:
 * смена без принятой машины — пустая запись, а машина, принятая вне смены,
 * никуда не относится.
 */
export async function acceptEquipment(input: {
  tenantId: string;
  operatorId: string;
  equipmentId: string;
  engineHours: number;
  shiftType: 'DAY' | 'NIGHT';
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, input.equipmentId);
    const profile = await tx.user.findFirst({
      where: {tenantId: input.tenantId, id: input.operatorId}, select: {timezone: true},
    });
    const timezone = profile?.timezone ?? 'Europe/Moscow';
    const productionDate = productionDateOf(timezone, now);

    // В базе есть частичный уникальный индекс Shift_one_active_per_equipment_key:
    // у машины может быть только одна смена в состоянии STARTED или
    // HANDOVER_PENDING — на любую дату. Это правильное правило: машина не может
    // работать в двух сменах сразу. Значит, незакрытая вчерашняя смена
    // блокирует открытие сегодняшней, и сказать об этом надо словами, а не
    // ошибкой уникальности из драйвера.
    const active = await tx.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        state: {in: ['STARTED', 'HANDOVER_PENDING']},
      },
      select: {id: true, state: true, productionDate: true},
    });
    if (active && active.productionDate.getTime() !== productionDate.getTime()) {
      throw new OperatorCommandError(
        409,
        `По этой установке не закрыта смена за ${active.productionDate.toISOString().slice(0, 10)}. `
        + 'Сдайте её, прежде чем открывать новую.',
      );
    }

    const existing = active ?? await tx.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        productionDate,
        state: {in: ['PLANNED', 'PENDING_ACCEPTANCE']},
      },
      select: {id: true, state: true, productionDate: true},
    });

    const shiftId = existing?.id ?? randomUUID();
    if (existing) {
      if (existing.state !== 'STARTED') {
        await tx.shift.update({
          where: {tenantId_id: {tenantId: input.tenantId, id: shiftId}},
          data: {state: 'STARTED', startedAt: now, startedById: input.operatorId, lastEditedById: input.operatorId},
        });
      }
    } else {
      await tx.shift.create({
        data: {
          id: shiftId,
          tenantId: input.tenantId,
          equipmentId: input.equipmentId,
          type: input.shiftType,
          state: 'STARTED',
          productionDate,
          timezone,
          createdById: input.operatorId,
          lastEditedById: input.operatorId,
          startedAt: now,
          startedById: input.operatorId,
        },
      });
    }

    await recordMeter(tx, {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      engineHours: input.engineHours,
      operatorId: input.operatorId,
      note: 'Приём установки',
      now,
    });

    await recordEvidence(tx, {
      tenantId: input.tenantId,
      shiftId,
      equipmentId: input.equipmentId,
      kind: 'STARTUP_READING',
      payload: {engineHours: input.engineHours, siteId: crew.siteId},
      operatorId: input.operatorId,
      clientCommandId: input.clientCommandId,
      now,
    });

    return {shiftId};
  });
}

/**
 * Моточасы: журнал показаний — источник истины, поле в карточке техники —
 * денормализованный кэш последнего значения. Обновляем оба, иначе списки
 * техники показывают вчерашнюю наработку.
 */
async function recordMeter(tx: Tx, input: {
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

async function recordEvidence(tx: Tx, input: {
  tenantId: string; shiftId: string; equipmentId: string;
  kind: 'KNOWLEDGE_TEST' | 'WEATHER_SNAPSHOT' | 'SITE_CHECK' | 'STARTUP_READING'
    | 'MAINTENANCE_ACTION' | 'FLUID_READING' | 'PILE_DRIVING' | 'LEADER_DRILLING';
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
 *
 * `entityId` снимка — `${clientCommandId}:${itemId}`: фото делается до
 * отправки чек-листа, когда записи дефекта ещё нет и привязать снимок не к
 * чему. Ключ команды даёт ту же привязку и не позволяет подставить чужой файл.
 */
async function requireConfirmedImages(
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
 * Шаблон чек-листа в базе существует ради целостности ссылок и снимка версии.
 * Содержание живёт в коде — здесь только его отражение.
 */
async function ensureTemplate(tx: Tx, tenantId: string, stage: ChecklistStage, operatorId: string) {
  const definition = getChecklist(stage);
  const key = {tenantId_templateKey_version: {tenantId, templateKey: stage, version: definition.version}};
  const existing = await tx.operatorChecklistTemplate.findUnique({where: key, select: {id: true}});
  if (existing) return {id: existing.id, definition};

  const created = await tx.operatorChecklistTemplate.create({
    data: {
      tenantId,
      templateKey: stage,
      version: definition.version,
      stage,
      equipmentModel: '*',
      definition: definition as unknown as Prisma.InputJsonValue,
      createdById: operatorId,
    },
    select: {id: true},
  });
  return {id: created.id, definition};
}

/**
 * Сдача чек-листа целиком, а не по одному пункту.
 *
 * ПОЧЕМУ ЦЕЛИКОМ. Осмотр — это одно решение «машина годна», а не двенадцать
 * независимых. Пока список не дошёл до конца, его выводы ничего не значат:
 * половина пунктов «ок» не означает, что вторая половина не остановит смену.
 */
export async function submitChecklist(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  equipmentId: string;
  stage: ChecklistStage;
  answers: ChecklistAnswer[];
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, input.equipmentId);
    await requireOpenShift(tx, input.tenantId, input.shiftId);

    const duplicate = await tx.operatorChecklistExecution.findUnique({
      where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
      select: {id: true},
    });
    if (duplicate) return {executionId: duplicate.id, blocked: false, defects: 0};

    const {id: templateId, definition} = await ensureTemplate(tx, input.tenantId, input.stage, input.operatorId);

    // Состав пунктов пересобираем на сервере по той же машине: список,
    // присланный телефоном, доверия не заслуживает — иначе пункт про мачту
    // исчезает из ответа, и осмотр «пройден» без него.
    const answeredConditions = definition.items
      .filter((item) => item.onlyWhen && input.answers.some((answer) => answer.itemId === item.id))
      .flatMap((item) => item.onlyWhen ?? []);
    const items = selectChecklistItems(definition, answeredConditions, {
      hasHammer: crew.equipment.hammerKind !== 'NONE',
      hasRotator: crew.equipment.isCombined,
    });

    const problems = validateChecklistRun(items, input.answers);
    if (problems.length > 0) {
      throw new OperatorCommandError(400, 'Чек-лист заполнен не полностью', problems);
    }

    await requireConfirmedImages(tx, input.tenantId, input.operatorId, input.clientCommandId, input.answers);

    const execution = await tx.operatorChecklistExecution.create({
      data: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: input.equipmentId,
        templateId,
        clientCommandId: input.clientCommandId,
        status: 'COMPLETED',
        templateSnapshot: {
          stage: definition.stage,
          version: definition.version,
          title: definition.title,
          items,
        } as unknown as Prisma.InputJsonValue,
        startedById: input.operatorId,
        startedAt: now,
        completedAt: now,
      },
      select: {id: true},
    });

    const byItem = new Map(items.map((item) => [item.id, item]));
    for (const answer of input.answers) {
      const item = byItem.get(answer.itemId);
      if (!item) continue;
      await tx.operatorChecklistAnswerRecord.create({
        data: {
          tenantId: input.tenantId,
          executionId: execution.id,
          itemId: answer.itemId,
          clientCommandId: `${input.clientCommandId}:${answer.itemId}`,
          result: answer.answer,
          value: (answer.measures ?? null) as Prisma.InputJsonValue,
          note: answer.note ?? null,
          mediaIds: (answer.mediaIds ?? []) as Prisma.InputJsonValue,
          itemSnapshot: item as unknown as Prisma.InputJsonValue,
          answeredAt: now,
          answeredById: input.operatorId,
        },
      });
    }

    const defects = collectDefectDrafts(input.stage, input.equipmentId, items, input.answers);
    for (const draft of defects) {
      const open = await tx.equipmentDefect.findFirst({
        where: {
          tenantId: input.tenantId,
          sourceKey: draft.sourceKey,
          status: {in: ['OPEN', 'IN_WORK']},
        },
        select: {id: true},
      });
      if (open) continue;
      await tx.equipmentDefect.create({
        data: {
          tenantId: input.tenantId,
          equipmentId: input.equipmentId,
          severity: draft.severity,
          status: 'OPEN',
          title: draft.title,
          description: draft.description,
          reportedById: input.operatorId,
          reportedAt: now,
          shiftId: input.shiftId,
          sourceKey: draft.sourceKey,
          evidenceMediaIds: draft.mediaIds as Prisma.InputJsonValue,
        },
      });
    }

    // Моточасы и долив жидкостей — не «данные чек-листа», а события парка.
    // Их место в журнале наработки и в свидетельствах смены, иначе механик
    // никогда не узнает, что в двигатель доливали масло третью смену подряд.
    const meterAnswer = input.answers.find((answer) => answer.measures?.engineHours !== undefined);
    if (meterAnswer?.measures?.engineHours !== undefined) {
      await recordMeter(tx, {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        engineHours: Math.round(meterAnswer.measures.engineHours),
        operatorId: input.operatorId,
        note: definition.title,
        now,
      });
    }

    const fluids = input.answers
      .filter((answer) => answer.measures && Object.keys(answer.measures).some((key) => key.endsWith('L')))
      .map((answer) => ({itemId: answer.itemId, ...answer.measures}));
    if (fluids.length > 0) {
      await recordEvidence(tx, {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: input.equipmentId,
        kind: 'FLUID_READING',
        payload: {stage: input.stage, fluids} as Prisma.InputJsonValue,
        operatorId: input.operatorId,
        clientCommandId: `${input.clientCommandId}:fluids`,
        now,
      });
    }

    return {
      executionId: execution.id,
      blocked: blockingFaults(items, input.answers).length > 0,
      defects: defects.length,
    };
  });
}

/** Отчёт смены — один на смену. Создаётся при первой записи выработки. */
async function ensureReport(tx: Tx, input: {
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

export type ProductionEntry =
  | {kind: 'PILES'; pileGradeId: string; count: number; picketId?: string; comment?: string}
  | {kind: 'DRILLING'; typeId: string; count: number; meters: number; picketId?: string}
  | {kind: 'DOWNTIME'; reasonId: string; hours: number; comment?: string};

/**
 * Запись выработки по ходу смены, а не одним отчётом в конце.
 *
 * ПОЧЕМУ ПО ХОДУ. Отчёт, заполняемый в 19:00 по памяти, — это оценка, а не
 * учёт. Свая, отмеченная сразу, помнит время; простой, отмеченный сразу,
 * помнит причину.
 */
export async function logProduction(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  entry: ProductionEntry;
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);
    const shiftRow = await tx.shift.findFirst({
      where: {tenantId: input.tenantId, id: input.shiftId},
      select: {productionDate: true, type: true},
    });
    if (!shiftRow) throw new OperatorCommandError(404, 'Смена не найдена');

    const reportId = await ensureReport(tx, {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      siteId: crew.siteId,
      equipmentId: shift.equipmentId,
      crewId: crew.id,
      productionDate: shiftRow.productionDate.toISOString().slice(0, 10),
      shiftType: shiftRow.type,
    });

    // Чек-лист ТБ — пропуск к работе этого вида, а не бумажка «на потом».
    // Он спрашивается один раз за смену перед первой записью: забивка и
    // бурение опасны по-разному, и общий инструктаж эти различия стирает.
    const requiredSafety = input.entry.kind === 'PILES'
      ? 'TB_PILING'
      : input.entry.kind === 'DRILLING' ? 'TB_DRILLING' : null;
    if (requiredSafety) {
      const passed = await tx.operatorChecklistExecution.findFirst({
        where: {
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          status: 'COMPLETED',
          template: {templateKey: requiredSafety},
        },
        select: {id: true},
      });
      if (!passed) {
        throw new OperatorCommandError(
          409,
          requiredSafety === 'TB_PILING'
            ? 'Сначала пройдите чек-лист ТБ по забивке свай'
            : 'Сначала пройдите чек-лист ТБ по лидерному бурению',
        );
      }
    }

    const {entry} = input;
    if (entry.kind === 'PILES') {
      if (entry.count <= 0) throw new OperatorCommandError(400, 'Количество свай должно быть больше нуля');
      await tx.pileWork.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          picketId: entry.picketId ?? null,
          pileGradeId: entry.pileGradeId,
          count: entry.count,
          comment: entry.comment ?? null,
          occurredAt: now,
        },
      });
    } else if (entry.kind === 'DRILLING') {
      if (entry.meters <= 0) throw new OperatorCommandError(400, 'Метры бурения должны быть больше нуля');
      await tx.leaderDrilling.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          picketId: entry.picketId ?? null,
          typeId: entry.typeId,
          count: entry.count,
          metersPerUnit: entry.count > 0 ? entry.meters / entry.count : 0,
          meters: entry.meters,
          occurredAt: now,
        },
      });
    } else {
      if (entry.hours <= 0) throw new OperatorCommandError(400, 'Длительность простоя должна быть больше нуля');
      await tx.reportDowntime.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          reasonId: entry.reasonId,
          // Простой в системе измеряется в ЧАСАХ. Единица здесь одна на всё
          // приложение: смешение часов и минут уже приводило к отчётам,
          // где простой измерялся сутками.
          duration: entry.hours,
          kind: 'DOWNTIME',
          status: 'CLOSED',
          comment: entry.comment ?? null,
          occurredAt: now,
        },
      });
    }

    return {reportId};
  }).catch((error: unknown) => {
    // Повтор той же команды при обрыве сети — не ошибка: запись уже есть.
    if (typeof error === 'object' && error !== null && (error as {code?: string}).code === 'P2002') {
      return {reportId: ''};
    }
    throw error;
  });
}

/** Оператор объявил, что работа окончена: дальше только ЕО после работы. */
export async function requestClosing(input: {tenantId: string; operatorId: string; shiftId: string}) {
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    await requireOpenShift(tx, input.tenantId, input.shiftId);
    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {state: 'HANDOVER_PENDING', lastEditedById: input.operatorId},
    });
    return {ok: true};
  });
}

/**
 * Закрытие смены.
 *
 * Послесменное обслуживание — условие закрытия, а не пожелание: машина,
 * оставленная без осмотра, утром становится чужой проблемой. Отсюда отказ
 * закрыть смену без завершённого ЕО после работы.
 */
export async function closeShift(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  comment: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    await requireOpenShift(tx, input.tenantId, input.shiftId);

    const done = await tx.operatorChecklistExecution.findFirst({
      where: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        status: 'COMPLETED',
        template: {templateKey: 'EO_AFTER'},
      },
      select: {id: true},
    });
    if (!done) {
      throw new OperatorCommandError(409, 'Сначала выполните ЕО после работы');
    }

    const shift = await tx.shift.findFirstOrThrow({
      where: {tenantId: input.tenantId, id: input.shiftId},
      select: {equipmentId: true},
    });
    const lastMeter = await tx.meterReading.findFirst({
      where: {tenantId: input.tenantId, equipmentId: shift.equipmentId},
      orderBy: {recordedAt: 'desc'},
      select: {engineHours: true},
    });

    await tx.report.updateMany({
      where: {tenantId: input.tenantId, shiftId: input.shiftId},
      data: {
        status: 'submitted',
        submittedAt: now,
        closingComment: input.comment,
        endingEngineHours: lastMeter?.engineHours ?? null,
        lastEditedById: input.operatorId,
      },
    });

    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {state: 'CLOSED', closedAt: now, closedById: input.operatorId, lastEditedById: input.operatorId},
    });

    return {ok: true};
  });
}
