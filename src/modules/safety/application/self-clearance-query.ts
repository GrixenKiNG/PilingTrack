/**
 * «Мой допуск» — что работник видит про СЕБЯ.
 *
 * ЗАЧЕМ. Модуль «ТБ и допуски» открыт всем ролям: инструктаж проходит каждый,
 * и дорога к своим инструктажам нужна каждому. Но вкладки инженера ОТ роль
 * машиниста не откроет — без личного раздела он попадал бы в модуль, где все
 * вкладки отвечают «Недостаточно прав». Это и есть тупик, а не доступ.
 *
 * ПРАВ ЗДЕСЬ НЕ СПРАШИВАЕМ, И ЭТО НЕ ДЫРА. Выборка жёстко сужена одним
 * `userId` — тем, что пришёл из сессии. Свои документы работник и так видит
 * без права `users.documents.read_all` (см. `services/users/user-documents.ts`),
 * свой журнал инструктажей — ровно те же его собственные подтверждения.
 * Чужого здесь не отдаётся ничего: идентификатор берётся из сессии маршрутом
 * и параметром запроса не управляется.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { getOperatorClearance, type OperatorClearance } from '@/modules/users';

/** Сколько последних записей журнала показываем человеку. */
const HISTORY_LIMIT = 20;

export interface SelfBriefingRecord {
  id: string;
  kind: 'INSTRUCTION' | 'KNOWLEDGE';
  recordedAt: string;
  documentTitle: string;
  documentVersion: string;
  /** «27 из 30». У ознакомления результата нет. */
  result: string | null;
  validUntil: string | null;
}

export interface SelfSafetyView {
  /** Тот же расчёт, по которому сервер пускает смену. */
  clearance: OperatorClearance;
  /** Последние записи журнала: ознакомления и проверки знаний вперемешку. */
  history: SelfBriefingRecord[];
  /** Действующая проверка знаний, если она есть. */
  knowledgeValidUntil: string | null;
}

export async function querySelfSafetyView(input: {
  tenantId: string;
  /** Из сессии. Маршрут обязан брать его у `requireAuth`, а не из запроса. */
  userId: string;
  now?: Date;
}): Promise<SelfSafetyView> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);
  if (!input.userId) throw new ServiceError('userId is required', 400);

  const now = input.now ?? new Date();
  const [clearance, records] = await Promise.all([
    getOperatorClearance(input.tenantId, input.userId, now),
    db.briefingRecord.findMany({
      where: { tenantId: input.tenantId, userId: input.userId },
      select: {
        id: true, kind: true, recordedAt: true, documentTitle: true,
        documentVersion: true, correct: true, total: true, validUntil: true,
      },
      orderBy: { recordedAt: 'desc' },
      take: HISTORY_LIMIT,
    }),
  ]);

  // Действующей считаем самую свежую проверку знаний: старая с более длинным
  // сроком встречается после пересдачи и говорит не о том.
  const latestKnowledge = records.find((record) => record.kind === 'KNOWLEDGE');

  return {
    clearance,
    knowledgeValidUntil: latestKnowledge?.validUntil?.toISOString() ?? null,
    history: records.map((record) => ({
      id: record.id,
      kind: record.kind,
      recordedAt: record.recordedAt.toISOString(),
      documentTitle: record.documentTitle,
      documentVersion: record.documentVersion,
      result: record.correct != null && record.total != null
        ? `${record.correct} из ${record.total}`
        : null,
      validUntil: record.validUntil?.toISOString() ?? null,
    })),
  };
}
