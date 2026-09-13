import {db} from '@/lib/db';
import {ServiceError} from '@/lib/service-error';
import type {BriefingRecordKind} from '@/generated/postgres-client/client';

/**
 * Журнал инструктажей: кто и когда читал инструкцию и сдавал проверку знаний.
 *
 * ЧТО ЭТО ЗА ВЫБОРКА. Не «состояние допуска» — его показывает контроль
 * документов (`users.documents.read_all`, экран «Документы»), — а история
 * действий за период. Инженеру ОТ нужна именно она: проверяющий спрашивает не
 * «кто допущен сейчас», а «покажите журнал за сентябрь».
 *
 * ПРАВО ТО ЖЕ, ЧТО У КОНТРОЛЯ ДОКУМЕНТОВ. `users.documents.read_all` — это
 * «видеть подтверждения всех работников, а не только свои»; журнал отвечает на
 * тот же вопрос в другом разрезе, и второе право развело бы доступ к одним и
 * тем же фактам по двум матрицам.
 *
 * ПОЧЕМУ ПРАВО ПРИХОДИТ АРГУМЕНТОМ. Прикладная матрица прав живёт в
 * `services/auth`, а модулям запрещено от неё зависеть (CLAUDE.md §1, проверяет
 * линтер). Тот же приём уже применён в контуре готовности —
 * `ReadinessExternalGrants`: решение принимает маршрут, запрос лишь отказывает,
 * если разрешения нет. Поле обязательное и без значения по умолчанию: забытый
 * аргумент должен ломать сборку, а не открывать журнал всем.
 */

/** Сколько строк отдаём за один раз. Печатная форма берёт столько же. */
const MAX_ROWS = 1000;

export interface BriefingJournalFilters {
  from?: Date;
  to?: Date;
  userId?: string;
  kind?: BriefingRecordKind;
}

export interface BriefingJournalRow {
  id: string;
  recordedAt: string;
  kind: BriefingRecordKind;
  userId: string;
  userName: string;
  userRole: string;
  documentCode: string;
  documentTitle: string;
  documentVersion: string;
  /** Итог проверки знаний словами: «8 из 8». У ознакомления результата нет. */
  result: string | null;
  validUntil: string | null;
}

/**
 * Строки идут от новых к старым — так читают с экрана.
 *
 * Печатная форма переворачивает их в хронологию: подписанный журнал читают
 * сверху вниз по возрастанию даты, иначе лист читается задом наперёд.
 *
 * `truncated` возвращается наружу намеренно: журнал, молча обрезанный на
 * тысячной строке, в распечатке выглядел бы как полный за период.
 */
export async function listBriefingJournal(input: {
  tenantId: string;
  /** `users.documents.read_all` у того, кто спрашивает. Считает маршрут. */
  mayReadAllDocuments: boolean;
  filters?: BriefingJournalFilters;
}): Promise<{rows: BriefingJournalRow[]; truncated: boolean}> {
  if (!input.mayReadAllDocuments) {
    throw new ServiceError('Недостаточно прав для просмотра журнала инструктажей', 403);
  }
  // Без организации выборка не сужается ничем — это ровно тот случай, когда
  // отказ правилен, а пустой или полный список одинаково неверны.
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const filters = input.filters ?? {};
  const records = await db.briefingRecord.findMany({
    where: {
      tenantId: input.tenantId,
      ...(filters.userId ? {userId: filters.userId} : {}),
      ...(filters.kind ? {kind: filters.kind} : {}),
      ...(filters.from || filters.to
        ? {
            recordedAt: {
              ...(filters.from ? {gte: filters.from} : {}),
              ...(filters.to ? {lte: filters.to} : {}),
            },
          }
        : {}),
    },
    orderBy: {recordedAt: 'desc'},
    take: MAX_ROWS + 1,
  });

  const truncated = records.length > MAX_ROWS;
  return {
    rows: records.slice(0, MAX_ROWS).map((record) => ({
      id: record.id,
      recordedAt: record.recordedAt.toISOString(),
      kind: record.kind,
      userId: record.userId,
      userName: record.userName,
      userRole: record.userRole,
      documentCode: record.documentCode,
      documentTitle: record.documentTitle,
      documentVersion: record.documentVersion,
      result: record.correct != null && record.total != null
        ? `${record.correct} из ${record.total}`
        : null,
      validUntil: record.validUntil?.toISOString() ?? null,
    })),
    truncated,
  };
}
