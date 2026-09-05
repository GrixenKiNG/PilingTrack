import {randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {requestReadinessSnapshot} from '@/modules/readiness/application/projection/request-snapshot';
import {roundDowntimeHours} from '@/modules/reports/domain/downtime-hours';
import {getChecklist} from '../domain/checklist-catalog';
import type {ChecklistStage, ShiftCondition} from '../domain/checklist-types';
import {
  collectDefectDrafts, validateChecklistRun, type ChecklistAnswer,
} from '../domain/checklist-run';
import {
  BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE,
  SLINGER_BRIEFING_DOCUMENT_TYPE, SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
  SYSTEM_DOCUMENT_TYPES,
} from '../domain/operator-credentials';
import {KNOWLEDGE_VALID_DAYS, scoreAttempt} from '../domain/knowledge-bank';
import {SAFETY_BRIEFING} from '../domain/safety-briefing';
import {SLINGER_BRIEFING} from '../domain/slinger-briefing';
import {resolveShiftConditions, selectChecklistItems} from '../domain/shift-conditions';
import type {ReadWeather} from '../domain/view-contracts';
import {weatherStop} from '../domain/work-warnings';
import {shiftWindow} from '../domain/shift-window';
import {missingPrerequisites} from '../domain/shift-phases';
import {
  classifyObservedHazard, validateIncident,
  type IncidentCategory, type IncidentSign,
} from '../domain/incidents';

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

const DAY_MS = 86_400_000;

async function requireCrew(tx: Tx, tenantId: string, operatorId: string, equipmentId: string) {
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

async function requireOpenShift(tx: Tx, tenantId: string, shiftId: string) {
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
function productionDateOf(timezone: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/**
 * Вид документа, который модуль ведёт сам. Создаётся при первом использовании:
 * заводить его руками в справочнике — лишний шаг для администратора, а
 * молча писать документ без вида нельзя, у таблицы внешний ключ.
 */
async function ensureDocumentType(tx: Tx, tenantId: string, name: string) {
  const normalizedName = name.trim().toLowerCase();
  const existing = await tx.userDocumentType.findFirst({
    where: {tenantId, normalizedName},
    select: {id: true},
  });
  if (existing) return existing.id;

  const template = SYSTEM_DOCUMENT_TYPES.find((type) => type.name === name);
  const created = await tx.userDocumentType.create({
    data: {
      tenantId,
      name,
      normalizedName,
      requiresExpiry: template?.requiresExpiry ?? true,
      leadTimeDays: template?.leadTimeDays ?? 30,
      requiredForOperator: false,
      notes: template?.notes ?? '',
    },
    select: {id: true},
  });
  return created.id;
}

/** Одна запись на вид документа: продлеваем существующую, а не плодим копии. */
async function upsertOperatorDocument(tx: Tx, input: {
  tenantId: string; operatorId: string; typeId: string;
  number: string; issuedAt: Date; expiresAt: Date | null;
}) {
  const existing = await tx.userDocument.findFirst({
    where: {tenantId: input.tenantId, userId: input.operatorId, typeId: input.typeId},
    orderBy: {createdAt: 'desc'},
    select: {id: true},
  });
  if (existing) {
    await tx.userDocument.update({
      where: {id: existing.id},
      data: {number: input.number, issuedAt: input.issuedAt, expiresAt: input.expiresAt},
    });
    return existing.id;
  }
  const created = await tx.userDocument.create({
    data: {
      tenantId: input.tenantId,
      userId: input.operatorId,
      typeId: input.typeId,
      number: input.number,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    },
    select: {id: true},
  });
  return created.id;
}

/**
 * Кто читает инструкцию: машинист или его помощник.
 *
 * Инструкции у них разные — про машину и про стропы, — и отметка о
 * прочтении ложится в разные виды документов. Один параметр вместо двух
 * почти одинаковых команд: разошлись бы они на первой же правке.
 */
export type BriefingAudience = 'OPERATOR' | 'ASSISTANT';

const BRIEFING_BY_AUDIENCE = {
  OPERATOR: {
    briefing: SAFETY_BRIEFING,
    briefingType: BRIEFING_DOCUMENT_TYPE,
    knowledgeType: KNOWLEDGE_DOCUMENT_TYPE,
  },
  ASSISTANT: {
    briefing: SLINGER_BRIEFING,
    briefingType: SLINGER_BRIEFING_DOCUMENT_TYPE,
    knowledgeType: SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
  },
} as const;

/** Работник прочитал свою инструкцию. Отметка привязана к версии текста. */
export async function acknowledgeBriefing(input: {
  tenantId: string; operatorId: string; audience?: BriefingAudience; now?: Date;
}) {
  const now = input.now ?? new Date();
  const kind = BRIEFING_BY_AUDIENCE[input.audience ?? 'OPERATOR'];
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const typeId = await ensureDocumentType(tx, input.tenantId, kind.briefingType);
    await upsertOperatorDocument(tx, {
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      typeId,
      number: kind.briefing.version,
      issuedAt: now,
      expiresAt: null,
    });
    return {version: kind.briefing.version};
  });
}

/**
 * Итог проверки знаний.
 *
 * Считает сервер по своему банку, а не по тому, что прислал телефон: экран
 * показывает верный ответ сразу, потому что это обучение, а не экзамен, но в
 * журнал уходит то, что человек действительно нажал.
 */
export async function submitKnowledgeTest(input: {
  tenantId: string;
  operatorId: string;
  picks: {questionId: string; picked: number}[];
  audience?: BriefingAudience;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const result = scoreAttempt(input.picks);
  if (result.total === 0) {
    throw new OperatorCommandError(400, 'Проверка знаний не заполнена');
  }
  if (result.correct !== result.total) {
    throw new OperatorCommandError(
      409,
      'Не на все вопросы дан верный ответ. Вопросы с ошибкой повторяются до верного ответа.',
      result.wrongIds,
    );
  }

  const validUntil = new Date(now.getTime() + KNOWLEDGE_VALID_DAYS * DAY_MS);
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const typeId = await ensureDocumentType(
      tx, input.tenantId, BRIEFING_BY_AUDIENCE[input.audience ?? 'OPERATOR'].knowledgeType,
    );
    await upsertOperatorDocument(tx, {
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      typeId,
      number: `${result.correct} из ${result.total}`,
      issuedAt: now,
      expiresAt: validUntil,
    });
    return {correct: result.correct, total: result.total, validUntil: validUntil.toISOString()};
  });
}

/**
 * Приём установки: оператор подтверждает машину и объект.
 *
 * Это и есть открытие смены. Моточасы здесь не спрашиваем: на приборной панели
 * их всё равно снимут при пуске, а два ввода подряд про одно и то же оператор
 * заполняет не глядя.
 */
export async function acceptEquipment(input: {
  tenantId: string;
  operatorId: string;
  equipmentId: string;
  shiftType: 'DAY' | 'NIGHT';
  clientCommandId: string;
  readWeather?: ReadWeather;
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
    // HANDOVER_PENDING — на любую дату. Незакрытая вчерашняя смена блокирует
    // открытие сегодняшней, и сказать об этом надо словами, а не ошибкой
    // уникальности из драйвера.
    const active = await tx.shift.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        state: {in: ['STARTED', 'HANDOVER_PENDING']},
      },
      select: {id: true, state: true, productionDate: true, plannedStartAt: true, plannedEndAt: true},
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
      select: {id: true, state: true, productionDate: true, plannedStartAt: true, plannedEndAt: true},
    });

    const planned = shiftWindow(productionDate, input.shiftType, timezone);
    const shiftId = existing?.id ?? randomUUID();
    if (existing) {
      if (existing.state !== 'STARTED') {
        await tx.shift.update({
          where: {tenantId_id: {tenantId: input.tenantId, id: shiftId}},
          data: {
            state: 'STARTED', startedAt: now,
            startedById: input.operatorId, lastEditedById: input.operatorId,
            // У смены, заведённой диспетчером заранее, план уже свой — не трогаем.
            plannedStartAt: existing.plannedStartAt ?? planned.plannedStartAt,
            plannedEndAt: existing.plannedEndAt ?? planned.plannedEndAt,
          },
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
          // Плановое окно по расписанию продукта: без него смена не рисуется
          // на шкале центра готовности — есть в списке, нет на графике.
          plannedStartAt: planned.plannedStartAt,
          plannedEndAt: planned.plannedEndAt,
        },
      });
    }

    // Условия смены снимаются ОДИН РАЗ, здесь, и дальше не пересматриваются.
    //
    // ПОЧЕМУ НЕ ПО ХОДУ. Состав осмотра обязан быть одинаковым на экране и на
    // сервере. Пока условия вычислялись при каждом чтении, потеплело за час —
    // и зимний пункт исчезал из списка между показом и отправкой. Хуже того,
    // серверная сборка списка опиралась на то, какие условные пункты телефон
    // соизволил прислать: не прислал зимний — значит зимы нет, осмотр «полный».
    // Снимок на момент открытия смены закрывает обе дыры разом.
    //
    // Предупреждения так не замораживаются: порыв ветра должен быть виден
    // сейчас, а не таким, каким был утром.
    const site = await tx.site.findFirst({
      where: {tenantId: input.tenantId, id: crew.siteId},
      select: {latitude: true, longitude: true},
    });
    const reading = input.readWeather && site?.latitude != null && site.longitude != null
      ? await input.readWeather(site.latitude, site.longitude)
      : null;
    const conditions: ShiftCondition[] = resolveShiftConditions({
      temperatureC: reading?.temperatureC ?? null,
      windMs: reading?.windMs ?? null,
      precipitationMmPerHour: reading?.precipitationMmPerHour ?? null,
      daylight: reading?.isDay ?? null,
    });

    await recordEvidence(tx, {
      tenantId: input.tenantId,
      shiftId,
      equipmentId: input.equipmentId,
      kind: 'STARTUP_READING',
      payload: {siteId: crew.siteId, conditions, weather: reading ?? null},
      operatorId: input.operatorId,
      clientCommandId: input.clientCommandId,
      now,
    });

    // Открытие смены закрывает шаг «Приёмка» в готовности — просим пересчёт.
    await requestReadinessSnapshot(tx as unknown as Parameters<typeof requestReadinessSnapshot>[0], {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      aggregateId: shiftId,
      aggregateType: 'Shift',
      triggerType: 'SHIFT_STARTED',
      triggerId: shiftId,
      occurredAt: now,
      shiftId,
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

type EvidenceKind = 'KNOWLEDGE_TEST' | 'WEATHER_SNAPSHOT' | 'SITE_CHECK' | 'STARTUP_READING'
  | 'MAINTENANCE_ACTION' | 'FLUID_READING' | 'PILE_DRIVING' | 'LEADER_DRILLING';

async function recordEvidence(tx: Tx, input: {
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
 * Условия, зафиксированные при открытии смены. Смена открыта до этой правки
 * либо погода молчала — условий нет, и список остаётся базовым: выдумывать
 * зиму задним числом хуже, чем её не знать.
 */
async function shiftConditions(tx: Tx, tenantId: string, shiftId: string): Promise<ShiftCondition[]> {
  const evidence = await tx.operatorShiftEvidence.findFirst({
    where: {tenantId, shiftId, kind: 'STARTUP_READING'},
    orderBy: {occurredAt: 'asc'},
    select: {payload: true},
  });
  const payload = evidence?.payload as {conditions?: unknown} | null;
  const stored = Array.isArray(payload?.conditions) ? payload.conditions : [];
  return stored.filter((value): value is ShiftCondition => typeof value === 'string');
}

/**
 * Сдача чек-листа целиком, а не по одному пункту.
 *
 * ПОЧЕМУ ЦЕЛИКОМ. Осмотр — это одно решение «машина годна», а не двенадцать
 * независимых. Пока список не дошёл до конца, его выводы ничего не значат:
 * половина пунктов «норма» не означает, что вторая половина в порядке.
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
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    // Установка смены и установка из запроса обязаны совпадать. Раньше
    // закрепление проверялось за присланным `equipmentId`, а смена бралась по
    // `shiftId` отдельно: машинист, закреплённый за своей машиной, мог
    // приложить осмотр к чужой смене, просто указав её идентификатор.
    if (shift.equipmentId !== input.equipmentId) {
      throw new OperatorCommandError(403, 'Осмотр относится к другой установке');
    }
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    // Порядок этапов проверяет сервер, а не только экран.
    const completed = await tx.operatorChecklistExecution.findMany({
      where: {tenantId: input.tenantId, shiftId: input.shiftId, status: 'COMPLETED'},
      select: {template: {select: {templateKey: true}}},
    });
    const done = completed
      .map((row) => row.template.templateKey as ChecklistStage);
    const missing = missingPrerequisites(input.stage, done);
    if (missing.length > 0) {
      throw new OperatorCommandError(
        409,
        `Сначала завершите: ${missing.map((stage) => getChecklist(stage).title).join(', ')}`,
      );
    }

    const duplicate = await tx.operatorChecklistExecution.findUnique({
      where: {tenantId_clientCommandId: {tenantId: input.tenantId, clientCommandId: input.clientCommandId}},
      select: {id: true},
    });
    if (duplicate) return {executionId: duplicate.id, defects: 0, createdDefects: []};

    const {id: templateId, definition} = await ensureTemplate(tx, input.tenantId, input.stage, input.operatorId);

    // Состав пунктов пересобираем на сервере: список, присланный телефоном,
    // доверия не заслуживает — иначе пункт про мачту исчезает из ответа, и
    // осмотр «пройден» без него. Условия берём из снимка, сделанного при
    // открытии смены (см. acceptEquipment), а не из того, какие условные
    // пункты телефон прислал: последнее означало бы, что сезонные пункты
    // объявляет о себе тот, кого они проверяют.
    const items = selectChecklistItems(definition, await shiftConditions(tx, input.tenantId, input.shiftId), {
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

    const drafts = collectDefectDrafts(input.stage, input.equipmentId, items, input.answers);
    // Заведённые здесь и сейчас, без тех, что уже висят по этому же пункту:
    // о повторно отмеченной той же течи оповещать некого — дефект по ней
    // открыт, и разбирается он в журнале, а не вторым сигналом в чат.
    const created: {severity: string; title: string}[] = [];
    for (const draft of drafts) {
      const open = await tx.equipmentDefect.findFirst({
        where: {
          tenantId: input.tenantId,
          sourceKey: draft.sourceKey,
          status: {in: ['OPEN', 'IN_WORK']},
        },
        select: {id: true},
      });
      if (open) continue;
      created.push({severity: draft.severity, title: draft.title});
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

    // Моточасы, долив жидкостей и остаток топлива — не «данные чек-листа», а
    // события парка. Их место в журнале наработки и в свидетельствах смены,
    // иначе механик никогда не узнает, что масло доливают третью смену подряд.
    const meter = findMeasure(input.answers, 'engineHours');
    if (meter !== null) {
      await recordMeter(tx, {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        engineHours: Math.round(meter),
        operatorId: input.operatorId,
        note: definition.title,
        now,
      });
    }

    const fuel = findMeasure(input.answers, 'fuelPercent');
    if (fuel !== null) {
      await recordEvidence(tx, {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: input.equipmentId,
        kind: 'FLUID_READING',
        payload: {fuelPercent: fuel} as Prisma.InputJsonValue,
        operatorId: input.operatorId,
        clientCommandId: `${input.clientCommandId}:fuel`,
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

    // Осмотр — четверть балла готовности. Без заказа пересчёта снимок остаётся
    // вчерашним: машинист прошёл обход, а центр готовности до следующего
    // события показывает «Осмотр не завершён».
    await requestReadinessSnapshot(tx as unknown as Parameters<typeof requestReadinessSnapshot>[0], {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      aggregateId: execution.id,
      aggregateType: 'OperatorChecklistExecution',
      triggerType: 'OPERATOR_CHECKLIST_COMPLETED',
      triggerId: execution.id,
      occurredAt: now,
      shiftId: input.shiftId,
    });

    return {
      executionId: execution.id,
      defects: created.length,
      // Опасные из заведённых — маршруту, чтобы оповестить после фиксации и
      // вне транзакции. Отправлять отсюда нельзя: откат сериализации отменил
      // бы запись, а сигнал в чат уже ушёл бы.
      createdDefects: created,
    };
  });
}

function findMeasure(answers: ChecklistAnswer[], key: string): number | null {
  for (const answer of answers) {
    const value = answer.measures?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
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
  | {kind: 'PILES'; pileGradeId: string; count: number; comment?: string}
  | {kind: 'DRILLING'; typeId: string; count: number; metersPerUnit: number}
  | {kind: 'DOWNTIME'; reasonId: string; hours: number; comment?: string};

/**
 * Запись выработки по ходу смены, а не одним отчётом в конце.
 *
 * ПОЧЕМУ ПО ХОДУ. Отчёт, заполняемый в 19:00 по памяти, — это оценка, а не
 * учёт. Свая, отмеченная сразу, помнит время; простой, отмеченный сразу,
 * помнит причину.
 *
 * ПОЧЕМУ БУРЕНИЕ СЧИТАЕТСЯ КАК В ОТЧЁТЕ. Оператор вводит количество скважин и
 * метры на одну, объём считается умножением. Так это устроено в отчёте за
 * смену, и вводить те же данные двумя разными способами в одном продукте — это
 * два разных числа в аналитике.
 */
export async function logProduction(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  entry: ProductionEntry;
  clientCommandId: string;
  readWeather?: ReadWeather;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    // Повтор уже принятой команды отсекаем ДО всех остальных правил.
    //
    // Ниже стоит перехват P2002 — он спасает мгновенный повтор при обрыве. Но
    // между первой отправкой и повтором проходит время, а правила ниже от
    // времени зависят: смена успевает закрыться, ветер — подняться. Тогда
    // повтор отвергается ещё до `create`, и машинист получает отказ по записи,
    // которая давно принята. Для отложенной отправки с телефона это обычный
    // случай, а не редкость.
    //
    // Запись уже есть — значит команда выполнена, и время её больше не судит.
    const duplicate = await findByCommand(
      tx, input.tenantId, input.entry.kind, input.clientCommandId,
    );
    if (duplicate) return {reportId: ''};

    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    // Погодный запрет проверяет сервер, а не только кнопка.
    //
    // Это единственное, что в модуле действительно запрещает работу, и раньше
    // запрет существовал только как погашенная кнопка на экране: прямой запрос
    // к API писал сваи при ветре 25 м/с. Порог измеряет внешний сервис, а не
    // человек, поэтому запрету здесь место.
    //
    // Простой пишется всегда: он и есть то, чем оператор объясняет остановку
    // по погоде. Запретить его значило бы оставить часы непогоды нигде.
    //
    // Обращение к погоде идёт внутри транзакции сознательно: ответ лежит в
    // общем кэше на 15 минут и защищён предохранителем с таймаутом в 3 с, так
    // что соединение почти всегда занято на время чтения из памяти. Ради
    // разрыва транзакции надвое пришлось бы читать смену дважды.
    if (input.entry.kind !== 'DOWNTIME' && input.readWeather) {
      const site = await tx.site.findFirst({
        where: {tenantId: input.tenantId, id: crew.siteId},
        select: {latitude: true, longitude: true},
      });
      const reading = site?.latitude != null && site.longitude != null
        ? await input.readWeather(site.latitude, site.longitude)
        : null;
      const stops = weatherStop(reading?.windMs ?? null, reading?.temperatureC ?? null);
      if (stops.length > 0) {
        throw new OperatorCommandError(
          409,
          `Работы прекращают: ${stops.map((stop) => stop.title).join(', ')}. `
          + 'Отметьте простой по погоде.',
        );
      }
    }

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

    const reportId = await ensureReport(tx, {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      siteId: crew.siteId,
      equipmentId: shift.equipmentId,
      crewId: crew.id,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
      shiftType: shift.type,
    });

    const {entry} = input;
    if (entry.kind === 'PILES') {
      if (entry.count <= 0) throw new OperatorCommandError(400, 'Количество свай должно быть больше нуля');
      await tx.pileWork.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          pileGradeId: entry.pileGradeId,
          count: entry.count,
          comment: entry.comment ?? null,
          occurredAt: now,
        },
      });
    } else if (entry.kind === 'DRILLING') {
      if (entry.count <= 0) throw new OperatorCommandError(400, 'Количество скважин должно быть больше нуля');
      if (entry.metersPerUnit <= 0) throw new OperatorCommandError(400, 'Глубина скважины должна быть больше нуля');
      await tx.leaderDrilling.create({
        data: {
          reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          typeId: entry.typeId,
          count: entry.count,
          metersPerUnit: entry.metersPerUnit,
          meters: entry.count * entry.metersPerUnit,
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

/**
 * Поправка к записи выработки.
 *
 * ПОЧЕМУ ВСТРЕЧНОЙ ЗАПИСЬЮ, А НЕ ПРАВКОЙ НА МЕСТЕ. Исходная строка остаётся
 * ровно такой, какой её ввёл человек, а рядом ложится разница со ссылкой и
 * причиной. Итог даёт сумма — и это главное следствие: отчёт, аналитика,
 * проекции и экран машиниста уже считают суммой, поэтому верный итог они
 * получают без единой правки в себе. Схема «пометить старую, вставить новую»
 * потребовала бы изменить каждого читателя, и первый же забытый показывал бы
 * двойной объём.
 *
 * ПОЧЕМУ ОПЕРАТОР ВВОДИТ «СКОЛЬКО БЫЛО НА САМОМ ДЕЛЕ», А НЕ РАЗНИЦУ. Разницу
 * считает сервер. Человек, ошибшийся при вводе, знает верное число; заставлять
 * его вычитать в уме — верный способ получить вторую ошибку поверх первой.
 */
export async function correctProduction(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  kind: 'PILES' | 'DRILLING' | 'DOWNTIME';
  entryId: string;
  /** Сколько было на самом деле: свай, скважин либо часов простоя. */
  actual: number;
  reason: string;
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new OperatorCommandError(400, 'Напишите, почему пришлось поправить');
  }
  if (input.actual < 0) {
    throw new OperatorCommandError(400, 'Итог не может быть отрицательным');
  }

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    const duplicate = await findByCommand(tx, input.tenantId, input.kind, input.clientCommandId);
    if (duplicate) return {correctionId: duplicate};

    const scope = {tenantId: input.tenantId, shiftId: input.shiftId, id: input.entryId};
    if (input.kind === 'PILES') {
      const original = await tx.pileWork.findFirst({
        where: scope, select: {id: true, reportId: true, pileGradeId: true, correctsId: true},
      });
      if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
      // Поправку не поправляют: правят исходную, и все поправки к ней
      // складываются. Цепочка «поправка поправки» читается только с
      // калькулятором и первой же теряет смысл.
      if (original.correctsId) {
        throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
      }
      const corrections = await tx.pileWork.aggregate({
        _sum: {count: true},
        where: {tenantId: input.tenantId, correctsId: original.id},
      });
      const base = await tx.pileWork.findUnique({where: {id: original.id}, select: {count: true}});
      const current = (base?.count ?? 0) + (corrections._sum.count ?? 0);
      const delta = Math.round(input.actual) - current;
      if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
      const created = await tx.pileWork.create({
        data: {
          reportId: original.reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          pileGradeId: original.pileGradeId,
          count: delta,
          correctsId: original.id,
          correctionNote: reason,
          occurredAt: now,
        },
        select: {id: true},
      });
      return {correctionId: created.id, was: current, now: Math.round(input.actual)};
    }

    if (input.kind === 'DRILLING') {
      const original = await tx.leaderDrilling.findFirst({
        where: scope,
        select: {id: true, reportId: true, typeId: true, metersPerUnit: true, count: true, correctsId: true},
      });
      if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
      if (original.correctsId) {
        throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
      }
      const corrections = await tx.leaderDrilling.aggregate({
        _sum: {count: true},
        where: {tenantId: input.tenantId, correctsId: original.id},
      });
      const current = original.count + (corrections._sum.count ?? 0);
      const delta = Math.round(input.actual) - current;
      if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
      const created = await tx.leaderDrilling.create({
        data: {
          reportId: original.reportId,
          tenantId: input.tenantId,
          shiftId: input.shiftId,
          clientCommandId: input.clientCommandId,
          typeId: original.typeId,
          count: delta,
          metersPerUnit: original.metersPerUnit,
          // Метры считаются той же глубиной, что и в исходной записи: правят
          // количество скважин, а не то, насколько глубоко бурили.
          meters: delta * original.metersPerUnit,
          correctsId: original.id,
          correctionNote: reason,
          occurredAt: now,
        },
        select: {id: true},
      });
      return {correctionId: created.id, was: current, now: Math.round(input.actual)};
    }

    const original = await tx.reportDowntime.findFirst({
      where: scope, select: {id: true, reportId: true, reasonId: true, duration: true, correctsId: true},
    });
    if (!original) throw new OperatorCommandError(404, 'Запись не найдена');
    if (original.correctsId) {
      throw new OperatorCommandError(409, 'Это уже поправка. Поправьте исходную запись.');
    }
    const corrections = await tx.reportDowntime.aggregate({
      _sum: {duration: true},
      where: {tenantId: input.tenantId, correctsId: original.id},
    });
    const current = original.duration + (corrections._sum.duration ?? 0);
    // Правка простоя подчиняется тому же правилу, что и запись: полные часы,
    // неполный вверх. Схема команды округлить это не может — `actual` там один
    // на сваи, бурение и простой, а часы из них только у простого. Ноль
    // остаётся нулём: «простоя не было» — законный ответ.
    const actual = roundDowntimeHours(input.actual);
    const delta = Math.round((actual - current) * 100) / 100;
    if (delta === 0) throw new OperatorCommandError(400, 'Число не изменилось');
    const created = await tx.reportDowntime.create({
      data: {
        reportId: original.reportId,
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        clientCommandId: input.clientCommandId,
        reasonId: original.reasonId,
        duration: delta,
        kind: 'DOWNTIME',
        status: 'CLOSED',
        correctsId: original.id,
        correctionNote: reason,
        occurredAt: now,
      },
      select: {id: true},
    });
    return {correctionId: created.id, was: current, now: actual};
  });
}

/** Повтор команды при обрыве сети: поправка уже записана — вернём её. */
async function findByCommand(
  tx: Tx, tenantId: string, kind: 'PILES' | 'DRILLING' | 'DOWNTIME', clientCommandId: string,
): Promise<string | null> {
  const where = {tenantId_clientCommandId: {tenantId, clientCommandId}};
  const row = kind === 'PILES'
    ? await tx.pileWork.findUnique({where, select: {id: true}})
    : kind === 'DRILLING'
      ? await tx.leaderDrilling.findUnique({where, select: {id: true}})
      : await tx.reportDowntime.findUnique({where, select: {id: true}});
  return row?.id ?? null;
}

/**
 * Происшествие на смене.
 *
 * ПОЧЕМУ ЗАПИСЬ, А НЕ ЗАПРЕТ. Оценку «критично» ставит правило по названным
 * признакам, и оно же говорит, что работы надо прекратить. Но прекращает их
 * человек: приложение не видит площадку и не может знать, чем обернётся
 * остановка посреди погружения сваи. Поэтому происшествие поднимает красное
 * предупреждение оператору и диспетчеру и остаётся на виду, пока его не
 * разберут, — но кнопок не запирает. Единственное, что здесь действительно
 * запрещает работу, — погода, и она измеряется прибором, а не человеком.
 *
 * ПОЧЕМУ ФОТО НЕ ОБЯЗАТЕЛЬНО. У происшествия с человеком первое действие —
 * помочь, а не снимать. Требовать снимок значит либо задержать помощь, либо
 * научить людей писать «прочее» вместо правды.
 */
export async function reportIncident(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  category: IncidentCategory;
  signs: IncidentSign[];
  injured: boolean;
  description: string;
  mediaIds?: string[];
  clientCommandId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const problems = validateIncident({
    category: input.category,
    signs: input.signs,
    injured: input.injured,
    description: input.description,
  });
  if (problems.length > 0) {
    throw new OperatorCommandError(400, problems[0], problems);
  }

  const classification = classifyObservedHazard({
    observedSigns: input.signs, injured: input.injured,
  });

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);

    const duplicate = await tx.safetyIncident.findUnique({
      where: {tenantId_clientCommandId: {
        tenantId: input.tenantId, clientCommandId: input.clientCommandId,
      }},
      select: {id: true, severity: true, stopRequired: true},
    });
    if (duplicate) {
      return {
        incidentId: duplicate.id,
        severity: duplicate.severity,
        stopRequired: duplicate.stopRequired,
      };
    }

    const mediaIds = await confirmedIncidentImages(
      tx, input.tenantId, input.operatorId, input.clientCommandId, input.mediaIds ?? [],
    );

    const incident = await tx.safetyIncident.create({
      data: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        equipmentId: shift.equipmentId,
        siteId: crew.siteId,
        category: input.category,
        // Состояние ведём тем же словарём, что достался от прежнего модуля:
        // таблица одна, и два набора состояний в ней означали бы, что
        // администратор видит строки, смысл которых зависит от того, каким
        // экраном их завели.
        state: classification.stopRequired ? 'STOP_REQUIRED' : 'REPORTED',
        severity: classification.severity,
        description: input.description.trim(),
        observedSigns: input.signs as unknown as Prisma.InputJsonValue,
        stopRequired: classification.stopRequired,
        injured: input.injured,
        evidenceMediaIds: mediaIds as unknown as Prisma.InputJsonValue,
        classificationRuleId: classification.ruleId,
        classificationRuleVersion: classification.ruleVersion,
        occurredAt: now,
        reportedById: input.operatorId,
        clientCommandId: input.clientCommandId,
      },
      select: {id: true},
    });

    // Готовность пересчитываем: происшествие — такой же факт о машине, как
    // осмотр, и центр готовности должен узнать о нём без ручного обновления.
    await requestReadinessSnapshot(tx as unknown as Parameters<typeof requestReadinessSnapshot>[0], {
      tenantId: input.tenantId,
      equipmentId: shift.equipmentId,
      aggregateId: incident.id,
      aggregateType: 'SafetyIncident',
      triggerType: 'SAFETY_INCIDENT_REPORTED',
      triggerId: incident.id,
      occurredAt: now,
      shiftId: input.shiftId,
    });

    return {
      incidentId: incident.id,
      severity: classification.severity,
      stopRequired: classification.stopRequired,
    };
  });
}

/**
 * Снимки происшествия: те же правила, что и у неисправностей в осмотре —
 * идентификатор без подтверждённой загрузки ничего не доказывает.
 */
async function confirmedIncidentImages(
  tx: Tx, tenantId: string, actorId: string, clientCommandId: string, mediaIds: string[],
): Promise<string[]> {
  if (mediaIds.length === 0) return [];
  const confirmed = await tx.media.findMany({
    where: {
      id: {in: mediaIds},
      tenantId,
      userId: actorId,
      entityType: 'safety_incident',
      entityId: clientCommandId,
      uploadStatus: 'completed',
      isDeleted: false,
    },
    select: {id: true, contentType: true},
  });
  const usable = confirmed
    .filter((media) => media.contentType?.startsWith('image/'))
    .map((media) => media.id);
  if (usable.length !== mediaIds.length) {
    throw new OperatorCommandError(400, 'Снимок не долетел до хранилища. Повторите отправку фото.');
  }
  return usable;
}

/** Оператор объявил, что работа закончена: дальше только ЕО после работы. */
export async function finishWork(input: {tenantId: string; operatorId: string; shiftId: string}) {
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    // Единственная команда, где проверки закрепления не было: чужую смену
    // можно было перевести в «сдаётся» одним идентификатором. Остальные
    // команды спрашивали бригаду, эта — нет.
    await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);
    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {state: 'HANDOVER_PENDING', lastEditedById: input.operatorId},
    });
    return {ok: true};
  });
}

/**
 * Закрытие смены и отправка отчёта.
 *
 * Смену принимать некому: бригада работает в одну смену, и утром установку
 * примет тот же машинист. Поэтому здесь нет передачи и подтверждения —
 * закрытие сразу отправляет отчёт диспетчеру.
 *
 * Послесменное обслуживание — условие закрытия, а не пожелание: машина,
 * оставленная без осмотра, утром становится чужой проблемой.
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
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);
    const started = await tx.shift.findFirst({
      where: {tenantId: input.tenantId, id: input.shiftId},
      select: {startedAt: true, timezone: true},
    });

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

    // Отчёт может не существовать: смена без единой сваи — это тоже смена, и
    // сдать её надо, иначе простой объекта нигде не отразится.
    const reportId = await ensureReport(tx, {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      siteId: crew.siteId,
      equipmentId: shift.equipmentId,
      crewId: crew.id,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
      shiftType: shift.type,
    });

    const [lastMeter, fuelEvidence] = await Promise.all([
      tx.meterReading.findFirst({
        where: {tenantId: input.tenantId, equipmentId: shift.equipmentId},
        orderBy: {recordedAt: 'desc'},
        select: {engineHours: true},
      }),
      tx.operatorShiftEvidence.findFirst({
        where: {tenantId: input.tenantId, shiftId: input.shiftId, kind: 'FLUID_READING'},
        orderBy: {occurredAt: 'desc'},
        select: {payload: true},
      }),
    ]);

    const fuelPayload = fuelEvidence?.payload as {fuelPercent?: number} | null;
    const fuelPercent = typeof fuelPayload?.fuelPercent === 'number'
      ? Math.round(fuelPayload.fuelPercent)
      : null;

    // Время смены в журнал отчётов: без него администратор видит «смена не
    // указана» и не знает, во сколько машина вышла и во сколько встала.
    // Часы берём из самой смены, а не из телефона: она их и так помнит.
    const timezone = started?.timezone ?? 'Europe/Moscow';
    const clock = (at: Date | null | undefined) => (at
      ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(at)
      : null);

    await tx.report.update({
      where: {id: reportId},
      data: {
        status: 'submitted',
        submittedAt: now,
        shiftStart: clock(started?.startedAt),
        shiftEnd: clock(now),
        closingComment: input.comment,
        endingEngineHours: lastMeter?.engineHours ?? null,
        endingFuelPercent: fuelPercent,
        lastEditedById: input.operatorId,
      },
    });

    await publishReportSubmitted(tx, input.tenantId, reportId);

    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {
        state: 'CLOSED', closedAt: now,
        closedById: input.operatorId, lastEditedById: input.operatorId,
      },
    });

    return {ok: true, reportId};
  });
}

/**
 * Событие «отчёт сдан» в общий журнал исходящих.
 *
 * ПОЧЕМУ ЭТО ОБЯЗАТЕЛЬНО. Дашборд и журнал отчётов читают таблицу `Report`
 * напрямую и видят смену сразу. Аналитика — нет: она живёт на проекциях
 * `ReportAnalytics` и `SiteDailySummary`, которые строит воркер по событию
 * `ReportSubmitted`. Без него смена, закрытая с телефона, в аналитику не
 * попадала вовсе: семь сданных отчётов и ноль строк проекций.
 *
 * Пишем в той же транзакции, что и сам отчёт: либо есть и запись, и событие,
 * либо нет ни того ни другого. Обработчик умеет добрать объект и оператора
 * по `reportId`, поэтому в полезной нагрузке достаточно итогов.
 */
async function publishReportSubmitted(tx: Tx, tenantId: string, reportId: string) {
  const report = await tx.report.findUnique({
    where: {id: reportId},
    select: {
      reportId: true, siteId: true, userId: true,
      piles: {select: {count: true}},
      drillings: {select: {meters: true}},
      downtimes: {select: {duration: true}},
    },
  });
  if (!report) return;

  await tx.outboxEvent.create({
    data: {
      type: 'ReportSubmitted',
      aggregateId: report.reportId,
      aggregateType: 'Report',
      tenantId,
      published: false,
      attempts: 0,
      payload: {
        siteId: report.siteId,
        userId: report.userId,
        tenantId,
        totalPiles: report.piles.reduce((sum, pile) => sum + pile.count, 0),
        totalDrilling: report.drillings.reduce((sum, drill) => sum + drill.meters, 0),
        totalDowntime: report.downtimes.reduce((sum, downtime) => sum + downtime.duration, 0),
      } as Prisma.InputJsonValue,
    },
  });
}
