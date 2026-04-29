import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'analytics.read');

    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    const siteId = request.nextUrl.searchParams.get('siteId');

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom и dateTo обязательны' }, { status: 400 });
    }

    const where: Record<string, unknown> = {
      date: { gte: dateFrom, lte: dateTo },
    };
    if (siteId && siteId !== 'all') where.siteId = siteId;

    const rows = await db.operatorPerformance.findMany({
      where,
      orderBy: [{ date: 'desc' }, { totalPiles: 'desc' }],
    });

    // Aggregate per operator
    const byOperator = new Map<string, {
      userId: string;
      userName: string;
      totalPiles: number;
      totalDrilling: number;
      totalDowntime: number;
      reportCount: number;
      days: number;
    }>();
    for (const r of rows) {
      const cur = byOperator.get(r.userId) || {
        userId: r.userId,
        userName: r.userName,
        totalPiles: 0,
        totalDrilling: 0,
        totalDowntime: 0,
        reportCount: 0,
        days: 0,
      };
      cur.totalPiles += r.totalPiles;
      cur.totalDrilling += r.totalDrilling;
      cur.totalDowntime += r.totalDowntime;
      cur.reportCount += r.reportCount;
      cur.days += 1;
      byOperator.set(r.userId, cur);
    }

    return NextResponse.json({
      rows,
      summary: Array.from(byOperator.values()).sort((a, b) => b.totalPiles - a.totalPiles),
    });
  },
  { domain: 'admin-analytics' }
);
