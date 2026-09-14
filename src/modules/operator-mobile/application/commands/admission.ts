/**
 * Допуск работника к смене: СИЗ, инструктажи, проверка знаний, документы.
 *
 * Всё, что отвечает на вопрос «можно ли этому человеку сегодня работать»,
 * до того как он подошёл к технике. Приёмка машины — уже соседний файл.
 */
import {verifyKnowledgeAttempt} from '../knowledge-attempt';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE, SLINGER_BRIEFING_DOCUMENT_TYPE, SLINGER_KNOWLEDGE_DOCUMENT_TYPE, SYSTEM_DOCUMENT_TYPES} from '../../domain/operator-credentials';
import {KNOWLEDGE_VALID_DAYS, scoreAttempt} from '../../domain/knowledge-bank';
import {SAFETY_BRIEFING} from '../../domain/safety-briefing';
import {PPE_ITEMS} from '../../domain/ppe';
import {SLINGER_BRIEFING} from '../../domain/slinger-briefing';
import {OperatorCommandError, DAY_MS} from './shared';
import type {Tx} from './shared';

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
 * Строка журнала инструктажей.
 *
 * Документ работника (выше) хранит состояние «подтверждение есть и действует»,
 * и обновляется на месте. Здесь пишется сам факт: кто, когда, какую редакцию
 * инструкции читал и с каким результатом сдавал. Две записи об одном действии —
 * не дублирование: у них разные вопросы и разный срок жизни, и журнал ОТ
 * собирается только из второй.
 *
 * ФИО и должность снимаются сюда копией — см. примечание к модели
 * `BriefingRecord`. Лишний чтение пользователя на команду допустимо: инструктаж
 * проходят раз в смену, а не в цикле.
 */
async function recordBriefingHistory(tx: Tx, input: {
  tenantId: string;
  operatorId: string;
  kind: 'INSTRUCTION' | 'KNOWLEDGE';
  briefing: {code: string; title: string; version: string};
  correct?: number;
  total?: number;
  validUntil?: Date | null;
  now: Date;
}) {
  const person = await tx.user.findFirst({
    where: {tenantId: input.tenantId, id: input.operatorId},
    select: {name: true, role: true},
  });
  await tx.briefingRecord.create({
    data: {
      tenantId: input.tenantId,
      userId: input.operatorId,
      kind: input.kind,
      // Учётку без имени в журнал пускаем с явной оговоркой: пустая графа
      // «ФИО» в распечатке читалась бы как сбой вывода.
      userName: person?.name?.trim() || 'Имя не указано',
      userRole: person?.role ?? '',
      documentCode: input.briefing.code,
      documentTitle: input.briefing.title,
      documentVersion: input.briefing.version,
      correct: input.correct ?? null,
      total: input.total ?? null,
      validUntil: input.validUntil ?? null,
      recordedAt: input.now,
    },
  });
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

/**
 * Работник проверил средства индивидуальной защиты на сегодня.
 *
 * ЗАПИСЫВАЕМ ФАКТ ПРОВЕРКИ, А НЕ ПОЛНОТУ КОМПЛЕКТА. Нехватка попадает в
 * `missing` и даёт предупреждение, но шаг закрывает: запертый работник
 * отметит, что каска есть, лишь бы начать смену, и мы получим ложную запись
 * вместо честной (см. `domain/ppe.ts`).
 *
 * ПОВТОРНОЕ ПОДТВЕРЖДЕНИЕ ЗА ТЕ ЖЕ СУТКИ ПЕРЕЗАПИСЫВАЕТ ЗАПИСЬ. Работник
 * может обнаружить нехватку позже и исправить отметку — вторая строка за те
 * же сутки была бы спором о том, какая из них верна.
 */
export async function confirmPpe(input: {
  tenantId: string;
  operatorId: string;
  productionDate: string;
  items: string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  // Коды приходят с телефона, и доверять им нельзя: чужой код в списке
  // означал бы подтверждение того, чего в каталоге нет.
  const known = new Set(PPE_ITEMS.map((item) => item.code));
  const items = input.items.filter((code) => known.has(code));
  const missing = PPE_ITEMS.map((item) => item.code).filter((code) => !items.includes(code));

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    await tx.ppeCheck.upsert({
      where: {
        tenantId_userId_productionDate: {
          tenantId: input.tenantId,
          userId: input.operatorId,
          productionDate: new Date(input.productionDate),
        },
      },
      create: {
        tenantId: input.tenantId,
        userId: input.operatorId,
        productionDate: new Date(input.productionDate),
        items,
        missing,
        confirmedAt: now,
      },
      update: {items, missing, confirmedAt: now},
    });
    return {items, missing};
  });
}

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
    await recordBriefingHistory(tx, {
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      kind: 'INSTRUCTION',
      briefing: kind.briefing,
      now,
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
  attemptToken: string;
  picks: {questionId: string; picked: number}[];
  audience?: BriefingAudience;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  try { await verifyKnowledgeAttempt(input, input.attemptToken, input.picks); }
  catch { throw new OperatorCommandError(400, 'Набор вопросов неполный или попытка истекла. Начните проверку заново.'); }
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
  const kind = BRIEFING_BY_AUDIENCE[input.audience ?? 'OPERATOR'];
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const typeId = await ensureDocumentType(tx, input.tenantId, kind.knowledgeType);
    await upsertOperatorDocument(tx, {
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      typeId,
      number: `${result.correct} из ${result.total}`,
      issuedAt: now,
      expiresAt: validUntil,
    });
    // Проверка знаний относится к той же инструкции, по которой составлен
    // набор вопросов: в журнале она стоит рядом с ознакомлением той же версии.
    await recordBriefingHistory(tx, {
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      kind: 'KNOWLEDGE',
      briefing: kind.briefing,
      correct: result.correct,
      total: result.total,
      validUntil,
      now,
    });
    return {correct: result.correct, total: result.total, validUntil: validUntil.toISOString()};
  });
}

