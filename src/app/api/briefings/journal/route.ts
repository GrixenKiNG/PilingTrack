import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { listBriefingJournal } from '@/modules/operator-mobile';
import { can } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

const BRIEFING_TYPES = ['INDUCTION', 'PRIMARY', 'REPEAT', 'UNSCHEDULED', 'TARGETED'] as const;

/** Граница периода из строки запроса. Мусор в параметре — не фильтр, а ошибка. */
function parseDate(value: string | null, edge: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError(`Неверная дата в параметре ${edge}`, 400);
  }
  return parsed;
}

/**
 * Журнал инструктажей за период — выборка инженера ОТ и диспетчера.
 * Право проверяет запрос (users.documents.read_all), как и в контроле документов.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const params = request.nextUrl.searchParams;
    const rawKind = params.get('kind');
    const kind = rawKind === 'INSTRUCTION' || rawKind === 'KNOWLEDGE' ? rawKind : null;
    if (rawKind && !kind) {
      return NextResponse.json({ error: 'Неизвестный вид записи' }, { status: 400 });
    }
    // Мусор в фильтре — это ошибка, а не «показать всё»: молча расширенная
    // выборка выглядит как ответ на заданный вопрос.
    const rawType = params.get('type');
    const type = BRIEFING_TYPES.find((value) => value === rawType) ?? null;
    if (rawType && !type) {
      return NextResponse.json({ error: 'Неизвестный вид инструктажа' }, { status: 400 });
    }
    const rawStatus = params.get('status');
    const status = rawStatus === 'signed' || rawStatus === 'awaiting' ? rawStatus : null;
    if (rawStatus && !status) {
      return NextResponse.json({ error: 'Неизвестный статус записи' }, { status: 400 });
    }

    try {
      const journal = await listBriefingJournal({
        tenantId,
        // Право из прикладной матрицы: модулю её знать нельзя, решение здесь.
        // Замещённая роль учитывается самим `can` — администратор в режиме
        // механика журнала не увидит, в этом и смысл режима.
        mayReadAllDocuments: can(actor, 'users.documents.read_all'),
        filters: {
          from: parseDate(params.get('from'), 'from'),
          to: parseDate(params.get('to'), 'to'),
          userId: params.get('userId') ?? undefined,
          kind: kind ?? undefined,
          type: type ?? undefined,
          instructorId: params.get('instructorId') ?? undefined,
          status: status ?? undefined,
        },
      });
      return NextResponse.json(journal);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
