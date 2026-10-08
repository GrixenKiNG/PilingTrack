import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import {
  getPendingDlqEntries,
  getDlqStats,
  retryDlqEntry,
  discardDlqEntry,
} from '@/core/outbox/dead-letter-queue';
import { db } from '@/lib/db';
import { requireTenantId } from '@/lib/tenant';

export const runtime = 'nodejs';

/**
 * Дополнить записи очереди отчётом: номером (`Report.reportId`, вид RM-…) и
 * объектом (`Site.name`). Без этого владелец видит только машинный
 * `aggregateId` и не понимает, о каком отчёте речь (W49-DLQ-OPERATIONS, п.1).
 *
 * Ответ агрегата — это уже номер отчёта, и по нему ищем строку отчёта: один
 * `findMany` на всю страницу по набору id, иначе на лимите 200 вышло бы 200
 * отдельных запросов (N+1). Организация — строгим равенством: фильтр
 * `tenantId IS NULL OR ...` вернул бы отчёты всех организаций. Не нашли строку
 * (`report: null`) — значит отчёт удалён; карточка так и подпишет.
 */
async function attachReportInfo<T extends { aggregateId: string | null }>(
  entries: T[],
  tenantId: string,
): Promise<Array<T & { report: { reportId: string; siteName: string } | null }>> {
  const ids = [...new Set(entries.map((e) => e.aggregateId).filter((id): id is string => Boolean(id)))];
  const reports = ids.length
    ? await db.report.findMany({
        where: { reportId: { in: ids }, tenantId },
        select: { reportId: true, site: { select: { name: true } } },
      })
    : [];
  const byId = new Map(reports.map((r) => [r.reportId, r]));

  return entries.map((entry) => {
    const report = entry.aggregateId ? byId.get(entry.aggregateId) : undefined;
    return {
      ...entry,
      report: report ? { reportId: report.reportId, siteName: report.site.name } : null,
    };
  });
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'dlq.manage');

    const tenantId = requireTenantId(user);

    const status = request.nextUrl.searchParams.get('status') ?? 'pending';
    // Нечисло давало NaN и 500 от Prisma, отрицательное — выборку с конца.
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 500) : 100;

    const stats = await getDlqStats();

    if (status === 'pending') {
      const entries = await getPendingDlqEntries(limit);
      return NextResponse.json({ entries: await attachReportInfo(entries, tenantId), stats });
    }

    // For resolved/discarded/all statuses, use raw query
    const where = status === 'all' ? {} : { status };
    const rows = await db.deadLetterQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json({
      entries: await attachReportInfo(
        rows.map((r) => ({
          id: r.id,
          eventType: r.eventType,
          aggregateId: r.aggregateId,
          payload: r.payload,
          errorMessage: r.errorMessage,
          attempts: r.attempts,
          sourceOutboxId: r.sourceOutboxId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          status: r.status,
        })),
        tenantId,
      ),
      stats,
    });
  },
  { domain: 'admin-dlq' }
);

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['retry', 'discard']),
});

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'dlq.manage');

    const body = await readJsonBody(request);
    const validation = actionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { id, action } = validation.data;

    if (action === 'retry') {
      const ok = await retryDlqEntry(id);
      if (!ok) {
        return NextResponse.json({ error: 'Не удалось переотправить' }, { status: 400 });
      }
      await recordAuditEvent({
        action: 'dlq.retried', scope: 'system', actorId: user?.id, targetId: id, tenantId: user?.tenantId,
      });
      return NextResponse.json({ ok: true, action });
    }

    await discardDlqEntry(id);
    await recordAuditEvent({
      action: 'dlq.discarded', scope: 'system', actorId: user?.id, targetId: id, tenantId: user?.tenantId,
    });
    return NextResponse.json({ ok: true, action });
  },
  { domain: 'admin-dlq' }
);
