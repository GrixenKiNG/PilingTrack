/**
 * Осмотры по чек-листу: ЕО до работы, ЕО после, условия смены.
 *
 * Ответы осмотра порождают дефекты, а дефекты влияют на готовность, поэтому
 * разбор ответов живёт в домене (`domain/checklist-run`), а здесь — только
 * запись результата и его последствия.
 */
import {enqueueCriticalDefects} from '@/core/notifications/durable-alert';
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {requestReadinessSnapshot} from '@/modules/readiness/server';
import {getChecklist} from '../../domain/checklist-catalog';
import type {ChecklistStage, ShiftCondition} from '../../domain/checklist-types';
import {collectDefectDrafts, validateChecklistRun, type ChecklistAnswer} from '../../domain/checklist-run';
import {selectChecklistItems} from '../../domain/shift-conditions';
import {missingPrerequisites} from '../../domain/shift-phases';
import {OperatorCommandError, requireCrew, requireOpenShift, recordEvidence, requireConfirmedImages, recordMeter} from './shared';
import type {Tx} from './shared';

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
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId, input.operatorId);
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

    await enqueueCriticalDefects(tx, {tenantId: input.tenantId, aggregateId: execution.id,
      equipmentId: input.equipmentId, reportedBy: input.operatorId, defects: created});
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

