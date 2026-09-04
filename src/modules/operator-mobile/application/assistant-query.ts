import {db} from '@/lib/db';
import {toDefectViews} from './defect-views';
import {checkOperatorDocuments} from '../domain/operator-admission';
import {
  briefingUpToDate, knowledgeValid,
  SLINGER_BRIEFING_DOCUMENT_TYPE, SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
} from '../domain/operator-credentials';
import {SLINGER_BRIEFING} from '../domain/slinger-briefing';
import {BRIEFING_DOCUMENT_TYPE, KNOWLEDGE_DOCUMENT_TYPE} from '../domain/operator-credentials';

/** Записи, которые модуль ведёт сам: в списке допусков им не место. */
const SERVICE_DOCUMENT_TYPES = new Set<string>([
  BRIEFING_DOCUMENT_TYPE,
  KNOWLEDGE_DOCUMENT_TYPE,
  SLINGER_BRIEFING_DOCUMENT_TYPE,
  SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
]);
import type {AssistantState} from '../domain/view-contracts';

/**
 * Рабочее место помощника машиниста.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Смену ведёт машинист: он принимает установку,
 * осматривает её и записывает выработку. Помощник в бригаде числится, но
 * команд смены не подаёт — так устроена проверка закрепления в модуле смены.
 * Поэтому его место — не урезанная смена, а то, что относится лично к нему:
 * инструктаж по стропальным работам, проверка знаний, собственные документы
 * со сроками и открытые неисправности машин, у которых он стоит.
 *
 * ПОЧЕМУ НЕИСПРАВНОСТИ ТОЖЕ ЗДЕСЬ. Право их заводить у помощника было, а
 * возможности перечитать записанное — нет: форма отвечала «Записано» и
 * забывала. Человек не мог проверить ни своё замечание, ни то, что машинист
 * уже завёл ту же поломку в осмотре, и вторая запись о том же тросе доходила
 * до диспетчера как отдельная неисправность.
 *
 * ПОЧЕМУ ЭКРАН ВООБЩЕ НУЖЕН. До него помощник видел в меню «Смену», открывал
 * её и получал отказ. Единственный заметный пункт вёл в тупик, а свои сроки —
 * медкомиссию, удостоверение стропальщика, электробезопасность — человек
 * узнавал от диспетчера по телефону.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕЛЬЗЯ НИЧЕГО ИСПРАВИТЬ В ДОКУМЕНТАХ. Их заводит администратор.
 * Дать работнику править срок своей медкомиссии значило бы сделать проверку
 * допуска бессмысленной.
 */
export async function queryAssistantState(input: {
  tenantId: string;
  assistantId: string;
  assistantName: string;
  now?: Date;
}): Promise<AssistantState> {
  const now = input.now ?? new Date();
  const {tenantId, assistantId} = input;

  const [documentTypes, documents, crews] = await Promise.all([
    db.userDocumentType.findMany({
      where: {tenantId, isActive: true},
      select: {id: true, name: true, requiresExpiry: true, leadTimeDays: true, requiredForOperator: true},
      orderBy: [{requiredForOperator: 'desc'}, {name: 'asc'}],
    }),
    db.userDocument.findMany({
      where: {tenantId, userId: assistantId},
      select: {typeId: true, number: true, expiresAt: true, type: {select: {name: true}}},
      orderBy: {createdAt: 'desc'},
    }),
    // Бригады, где человек записан помощником. Показываем машину и объект:
    // «куда мне сегодня» — первый вопрос смены, и ответ на него не должен
    // требовать звонка диспетчеру.
    db.crewAssistant.findMany({
      // Связь помощника с бригадой ведётся полем userId: строка переживает
      // удаление пользователя, сохраняя имя на момент назначения.
      where: {userId: assistantId, crew: {isActive: true, equipment: {tenantId}}},
      select: {
        crew: {
          select: {
            id: true,
            site: {select: {name: true}},
            equipment: {select: {id: true, name: true, model: true}},
            operator: {select: {name: true}},
          },
        },
      },
    }),
  ]);

  // Неисправности берём вторым запросом: их круг задают машины бригад, а те
  // известны только после первого. Ни одной бригады — ни одного запроса.
  const equipmentIds = crews
    .map((row) => row.crew.equipment?.id)
    .filter((id): id is string => Boolean(id));
  const defects = equipmentIds.length === 0 ? [] : await db.equipmentDefect.findMany({
    // Строгое равенство по тенанту, как и везде: машина из другой организации
    // в этот список попасть не может.
    where: {tenantId, equipmentId: {in: equipmentIds}, status: {in: ['OPEN', 'IN_WORK']}},
    select: {
      id: true, title: true, severity: true, status: true,
      reportedAt: true, reportedById: true,
      equipment: {select: {name: true}},
    },
    // Порядок значений DefectSeverity в схеме идёт от LOW к CRITICAL, поэтому
    // 'desc' поднимает наверх запрет эксплуатации.
    orderBy: [{severity: 'desc'}, {reportedAt: 'desc'}],
    take: 20,
  });

  // Машину подписываем поверх общего вида: она есть только у помощника —
  // он стоит у нескольких, машинист всегда у одной. Сопоставляем по
  // идентификатору, а не по месту в списке: порядок — не обещание сериализатора.
  const equipmentNames = new Map(defects.map((defect) => [defect.id, defect.equipment?.name ?? '—']));
  const defectViews = (await toDefectViews({tenantId, viewerId: assistantId, defects}))
    .map((view) => ({...view, equipmentName: equipmentNames.get(view.id) ?? '—'}));

  const checks = checkOperatorDocuments(documentTypes, documents, now);

  const briefingDocument = documents.find(
    (document) => document.type?.name === SLINGER_BRIEFING_DOCUMENT_TYPE,
  );
  const knowledgeDocument = documents.find(
    (document) => document.type?.name === SLINGER_KNOWLEDGE_DOCUMENT_TYPE,
  );
  const acknowledgedVersion = briefingDocument?.number ?? null;
  const knowledgeUntil = knowledgeDocument?.expiresAt ?? null;

  return {
    assistant: {id: assistantId, name: input.assistantName},
    // Служебные записи модуля из списка допусков убираем — все четыре.
    //
    // Свои (инструктаж и проверка знаний помощника) показываются отдельными
    // карточками со своими кнопками: дублировать их строкой «не заведён»
    // значило бы отвечать на один вопрос дважды и по-разному. Чужие
    // (инструктаж и проверка машиниста) в списке допусков помощника — просто
    // ложное красное: он их проходить и не должен.
    documents: checks.filter((check) => !SERVICE_DOCUMENT_TYPES.has(check.name)),
    briefing: {
      code: SLINGER_BRIEFING.code,
      title: SLINGER_BRIEFING.title,
      version: SLINGER_BRIEFING.version,
      readingMinutes: SLINGER_BRIEFING.readingMinutes,
      acknowledgedVersion,
      ok: briefingUpToDate(acknowledgedVersion, SLINGER_BRIEFING.version),
    },
    knowledge: {
      validUntil: knowledgeUntil?.toISOString() ?? null,
      lastResult: knowledgeDocument?.number ?? null,
      ok: knowledgeValid(knowledgeUntil, now),
    },
    defects: defectViews,
    crews: crews
      // Бригада без машины к заведению неисправности непригодна и на
      // экране бесполезна: показывать «Установка: —» нечего.
      .filter((row) => row.crew.equipment !== null)
      .map((row) => ({
        crewId: row.crew.id,
        equipmentId: row.crew.equipment?.id ?? '',
        siteName: row.crew.site?.name ?? '—',
        equipmentName: row.crew.equipment?.name ?? '—',
        equipmentModel: row.crew.equipment?.model ?? '',
        operatorName: row.crew.operator?.name ?? '—',
      })),
  };
}
