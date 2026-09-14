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
import { SAFETY_INSTRUCTIONS } from '../instructions';
import {
  evaluateBriefingRequirements, type BriefingRequirements,
} from '../domain/briefing-requirements';

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
  /**
   * Что осталось пройти по инструктажам. Тот же расчёт, что видит инженер ОТ
   * в сводке: человек и проверяющий должны читать про один день одно и то же.
   */
  briefings: BriefingRequirements;
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
  const [user, clearance, records, acquaintance] = await Promise.all([
    db.user.findFirst({
      where: { id: input.userId, tenantId: input.tenantId },
      select: { role: true },
    }),
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
    // История ознакомлений берётся ОТДЕЛЬНО и без ограничения по числу строк.
    // Считать требования по показанным двадцати записям нельзя: у человека с
    // длинной историей нужное прочтение оказалось бы за краем выборки, и он
    // без всякой причины попал бы в «ожидают ознакомления».
    db.briefingRecord.findMany({
      where: { tenantId: input.tenantId, userId: input.userId, kind: 'INSTRUCTION' },
      select: { documentCode: true, documentVersion: true, recordedAt: true },
      orderBy: { recordedAt: 'desc' },
    }),
  ]);

  if (!user) throw new ServiceError('Работник не найден', 404);

  // Действующей считаем самую свежую проверку знаний: старая с более длинным
  // сроком встречается после пересдачи и говорит не о том.
  const latestKnowledge = records.find((record) => record.kind === 'KNOWLEDGE');

  return {
    clearance,
    briefings: evaluateBriefingRequirements(SAFETY_INSTRUCTIONS, user.role, acquaintance, now),
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
