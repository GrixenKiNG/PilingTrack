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
 * Query: ?name=operator-performance | site-daily | site-weekly | all (default)
 *
 * Response: { results: [{ name, rowsWritten, durationMs }, ...] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import {
  rebuildOperatorPerformance,
  rebuildSiteDailySummary,
  rebuildSiteWeeklyTrend,
  rebuildAll,
  type ProjectionName,
  type RebuildResult,
} from '@/modules/reports/application/projections/rebuild';

export const runtime = 'nodejs';

const VALID: ProjectionName[] = ['operator-performance', 'site-daily', 'site-weekly', 'all'];

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'projections.rebuild');

    const nameParam = (request.nextUrl.searchParams.get('name') || 'all') as ProjectionName;
    if (!VALID.includes(nameParam)) {
      return NextResponse.json(
        { error: `Unknown projection. Allowed: ${VALID.join(', ')}` },
        { status: 400 },
      );
    }

    let results: RebuildResult[];
    if (nameParam === 'all') {
      results = await rebuildAll();
    } else if (nameParam === 'operator-performance') {
      results = [await rebuildOperatorPerformance()];
    } else if (nameParam === 'site-daily') {
      results = [await rebuildSiteDailySummary()];
    } else {
      results = [await rebuildSiteWeeklyTrend()];
    }

    return NextResponse.json({ results });
  },
  { domain: 'admin-projections' },
);
