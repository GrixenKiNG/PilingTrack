/**
 * POST /api/admin/projections/rebuild
 *
 * Recompute one or all read-side projections from the Report source of truth.
 * Use cases:
 *   - A new projector was added/changed and historical events were already
 *     marked projected=true (so the runtime worker will not replay them).
 *   - Suspect projection drift after a manual DB edit.
 *   - First-time bring-up after restoring from a dump.
 *
 * Query: ?name=site-daily | site-weekly | report-analytics | all (default)
 *
 * `operator-performance` и `report-stats` убраны 17.08.2026 вместе с самими
 * проекциями — их не читала ни одна витрина.
 *
 * Response: { results: [{ name, rowsWritten, durationMs }, ...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';
import {
  rebuildReportAnalytics,
  rebuildSiteDailySummary,
  rebuildSiteWeeklyTrend,
  rebuildAll,
  type ProjectionName,
  type RebuildResult,
} from '@/modules/reports/application/projections/rebuild';

export const runtime = 'nodejs';

const VALID: ProjectionName[] = ['site-daily', 'site-weekly', 'report-analytics', 'all'];

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'projections.rebuild');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;

    const nameParam = (request.nextUrl.searchParams.get('name') || 'all') as ProjectionName;
    if (!VALID.includes(nameParam)) {
      return NextResponse.json(
        { error: `Неизвестная проекция. Допустимые: ${VALID.join(', ')}` },
        { status: 400 },
      );
    }

    let results: RebuildResult[];
    if (nameParam === 'all') {
      results = await rebuildAll();
    } else if (nameParam === 'report-analytics') {
      results = [await rebuildReportAnalytics()];
    } else if (nameParam === 'site-daily') {
      results = [await rebuildSiteDailySummary()];
    } else {
      results = [await rebuildSiteWeeklyTrend()];
    }

    // Пересборка меняет цифры витрин и аналитики одним запросом, поэтому должна
    // оставлять след: без него вопрос «почему у меня другие числа, чем вчера»
    // упирается в отсутствие записи о том, что её кто-то запускал (F-R34-23).
    //
    // Best-effort: проекции уже пересобраны — сбой записи следа не должен
    // превращать успешную пересборку в 500 и толкать админа повторять запрос.
    try {
      await recordAuditEvent({
        action: 'projections.rebuilt',
        scope: 'projections',
        actorId: actor.id,
        metadata: {
          names: results.map((result) => result.name),
          rowsWritten: results.reduce((sum, result) => sum + result.rowsWritten, 0),
        },
      });
    } catch (err) {
      logger.error('Projections rebuild: audit write failed', err, { name: nameParam });
    }

    return NextResponse.json({ results });
  },
  { domain: 'admin-projections' },
);
