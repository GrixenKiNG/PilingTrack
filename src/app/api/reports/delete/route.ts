import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { pileLengthMeters } from '@/lib/pile-length';
import { formatRuDate } from '@/lib/format';
import { createReportEvent } from '@/modules/reports';
import { saveToOutbox } from '@/services/reports/outbox-publisher';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

export const runtime = 'nodejs';

const schema = z.object({ reportId: z.string().min(1) });

/**
 * Что уничтожается вместе с отчётом (F-R34-1). Отдельный тип, а не вывод
 * из запроса: снимок уходит и в доменное событие, и в запись аудита, и его
 * состав — часть контракта следа, а не внутренность запроса.
 */
interface DeletedReportSnapshot {
  reportId: string;
  date: string;
  siteId: string;
  siteName: string;
  operatorId: string;
  operatorName: string;
  /** Свай, шт. */
  totalPiles: number;
  /** Погонных метров свай — по длине марки (`pileLengthMeters`), шт × м. */
  totalPileMeters: number;
  /** Бурение, м. */
  totalDrillingMeters: number;
  /** Простои, ч. */
  totalDowntimeHours: number;
}

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.manage_all');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Tenant ownership (IDOR guard, fail-closed): reportId is globally
    // unique, so a delete-by-reportId with no tenant check would let this
    // caller's tenant delete any tenant's report. Verify scope before the
    // (irreversible) delete, mirroring dictionary-service.ts's pattern.
    //
    // Снимок, удаление и событие — в ОДНОЙ транзакции (F-R34-1): раньше
    // `db.report.delete` вызывался напрямую (без аудита и без outbox-события),
    // и от целого дня выработки — свай, метров, простоев — не оставалось ни
    // следа, ни источника для проекций. Снимок читается в той же транзакции,
    // что и удаление: иначе между чтением и удалением остаётся окно, в котором
    // след описывает уже не то состояние.
    let deleted: DeletedReportSnapshot | null = null;
    try {
      deleted = await db.$transaction(async (tx) => {
        const report = await tx.report.findFirst({
          where: { reportId: parsed.data.reportId, tenantId },
          select: {
            id: true,
            reportId: true,
            date: true,
            siteId: true,
            userId: true,
            version: true,
            site: { select: { name: true } },
            user: { select: { name: true } },
            piles: { select: { count: true, pileGrade: { select: { lengthMm: true } } } },
            drillings: { select: { meters: true } },
            downtimes: { select: { duration: true } },
          },
        });
        if (!report) return null;

        const before: DeletedReportSnapshot = {
          reportId: report.reportId,
          date: report.date,
          siteId: report.siteId,
          siteName: report.site.name,
          operatorId: report.userId,
          operatorName: report.user.name,
          totalPiles: report.piles.reduce((sum, pile) => sum + (pile.count || 0), 0),
          totalPileMeters: report.piles.reduce(
            (sum, pile) =>
              sum + (pile.count || 0) * pileLengthMeters({ gradeLengthMm: pile.pileGrade.lengthMm }),
            0,
          ),
          totalDrillingMeters: report.drillings.reduce((sum, d) => sum + (d.meters || 0), 0),
          totalDowntimeHours: report.downtimes.reduce((sum, d) => sum + (d.duration || 0), 0),
        };

        await tx.report.delete({ where: { id: report.id } });

        // Событие пишется тем же путём, что и остальные события отчётов —
        // строка outbox в транзакции, — но полным конвертом: обработчик сброса
        // кэша берёт организацию из колонки, а проекции недельного тренда
        // читают siteId/date из самого события, и строки отчёта, по которой
        // их можно было бы дочитать, к моменту обработки уже нет.
        await saveToOutbox(tx, [
          createReportEvent(
            'ReportDeleted',
            report.reportId,
            {
              id: report.reportId,
              userId: report.userId,
              version: report.version,
              deletedAt: new Date().toISOString(),
              // date/siteId и итоги дня — из снимка («before»), чтобы событие
              // и след аудита описывали одно и то же состояние.
              ...before,
            },
            {
              userId: report.userId,
              siteId: report.siteId,
              tenantId,
              version: report.version,
            },
          ),
        ]);

        return before;
      }, DEFAULT_TX_OPTIONS);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Record to delete') || message.includes('not found')) {
        return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 });
      }
      throw err;
    }

    if (!deleted) {
      return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 });
    }

    // Recompute derived projections so deleting a report doesn't leave
    // orphaned analytics rows (ReportAnalytics is keyed per-report;
    // SiteDailySummary rebuilds from the remaining reports for this
    // site+date, dropping the row if it was the last).
    //
    // Пересчёт OperatorPerformance отсюда убран 17.08.2026 вместе с самой
    // проекцией: её не читала ни одна витрина.
    //
    // Best-effort: the report is already gone, and the nightly rebuild is a
    // backstop — a recompute failure must not turn a successful delete into
    // a 500.
    try {
      const { recomputeSiteDailySummary } = await import('@/services/reports/event-handlers');
      await db.reportAnalytics.deleteMany({ where: { reportId: parsed.data.reportId } });
      await recomputeSiteDailySummary(deleted.siteId, deleted.date);
    } catch (err) {
      const { logger } = await import('@/lib/logger');
      logger.error('Report delete: projection recompute failed', err, {
        reportId: parsed.data.reportId,
      });
    }

    // След в ленте аудита. Пишется после коммита: recordFeedbackEvent
    // сохраняет глобальным клиентом, а не переданной транзакцией, — внутрь
    // `$transaction` выше его не завести. Заголовок задаётся здесь, а не через
    // recordAuditEvent: тот берёт русский текст из AUDIT_DESCRIPTIONS, и без
    // строки для report.deleted лента показала бы владельцу машинный код.
    //
    // Best-effort (F-R34-1b): отчёт уже удалён и безвозвратно — падение записи
    // следа не должно превращать успешное удаление в 500, иначе админ
    // повторит запрос и получит 404 по уже удалённому отчёту.
    try {
      await recordFeedbackEvent({
        level: 'warn',
        scope: 'reports',
        action: 'report.deleted',
        title: 'Отчёт удалён',
        message: `Отчёт за ${formatRuDate(deleted.date)} по объекту «${deleted.siteName}» удалён без возможности восстановления.`,
        audience: 'OPERATIONS',
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        actor: { id: user!.id, name: user!.name, role: user!.role },
        targetId: deleted.reportId,
        metadata: { tenantId, before: deleted },
      });
    } catch (err) {
      const { logger } = await import('@/lib/logger');
      logger.error('Report delete: audit write failed', err, {
        reportId: parsed.data.reportId,
      });
    }

    return NextResponse.json({ ok: true });
  },
  { domain: 'reports' }
);
