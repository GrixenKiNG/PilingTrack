/**
 * GET /api/sync/updates
 *
 * Pull sync endpoint — returns server-side changes since cursor.
 * Clients use this to update their local IndexedDB with latest server state.
 *
 * Query params:
 *   since: timestamp (ms) — last sync cursor
 *   siteId: optional — filter by site
 *
 * Response:
 *   { reports: [...], events: [...], cursor: timestamp }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const since = searchParams.get('since');
  const siteId = searchParams.get('siteId');

  if (!since) {
    return NextResponse.json(
      { error: 'since parameter is required' },
      { status: 400 }
    );
  }

  const sinceDate = new Date(Number(since));
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const cursor = searchParams.get('cursor') || undefined;

  // Fetch reports updated since cursor
  const reportWhere: Record<string, unknown> = {
    updatedAt: { gte: sinceDate },
  };

  // Filter by user access
  if (user!.role !== 'ADMIN') {
    reportWhere.userId = user!.id;
  }

  if (siteId) {
    reportWhere.siteId = siteId;
  }

  const { paginateQuery } = await import('@/lib/pagination');
  const reportsResult = await paginateQuery(
    (args) =>
      db.report.findMany({
        ...args,
        include: {
          user: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          piles: { include: { pileGrade: true } },
          drillings: { include: { type: true } },
          downtimes: { include: { reason: true } },
        },
      }),
    { cursor, limit },
    {
      where: reportWhere,
      orderBy: { updatedAt: 'asc' },
    }
  );

  // Fetch relevant feedback events (alerts, notifications)
  const eventsCursor = searchParams.get('eventsCursor') || undefined;
  const eventsWhere: Record<string, unknown> = {
    createdAt: { gte: sinceDate },
    audience: 'OPERATIONS',
  };
  const eventsResult = await paginateQuery(
    (args) => db.feedbackEvent.findMany(args as any),
    { cursor: eventsCursor, limit: Math.min(25, limit) },
    {
      where: eventsWhere,
      orderBy: { createdAt: 'asc' },
    }
  );

  return NextResponse.json({
    reports: reportsResult.data,
    events: eventsResult.data,
    cursor: Date.now(),
    nextCursor: reportsResult.nextCursor,
    eventsNextCursor: eventsResult.nextCursor,
    hasMore: reportsResult.hasMore,
  });
}, { domain: 'sync' });
