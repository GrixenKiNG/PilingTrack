/**
 * GET /api/admin/analytics/overview — period production overview, computed
 * from real reports (no projections, no assumptions):
 *   - KPI: pile meters / piles / drilling with % deltas vs the previous
 *     equal-length period; downtime % (same formula as OperatorPerformance:
 *     downtime hours ÷ shift hours, over reports whose shift times are known).
 *   - daily pile-meters series (Динамика погонных метров)
 *   - equipment usage: days-with-report ÷ period days per rig
 *   - site rating by pile meters
 *   - per-operator table: worked hours (null when shift times unknown),
 *     meters, piles, drilling, downtime %.
 * Meters always resolve through pileLengthMeters (PileGrade.lengthMm).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { db } from '@/lib/db';
import { pileLengthMeters } from '@/lib/pile-length';

export const runtime = 'nodejs';

interface ReportRow {
  date: string;
  userId: string;
  userName: string;
  equipmentId: string | null;
  equipmentName: string | null;
  siteId: string;
  siteName: string;
  shiftMinutes: number | null;
  piles: number;
  meters: number;
  drilling: number;
  downtime: number;
}

function shiftMinutesOf(shiftStart: string | null, shiftEnd: string | null): number | null {
  if (!shiftStart || !shiftEnd) return null;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [eh, em] = shiftEnd.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return null;
  let minutes = eh * 60 + em - sh * 60 - sm;
  if (minutes < 0) minutes += 24 * 60; // night shift wraps past midnight
  return minutes;
}

async function loadPeriod(tenantId: string, from: string, to: string, siteId: string | null): Promise<ReportRow[]> {
  const reports = await db.report.findMany({
    where: {
      tenantId,
      date: { gte: from, lte: to },
      status: { not: 'draft' },
      ...(siteId ? { siteId } : {}),
    },
    select: {
      date: true,
      userId: true,
      equipmentId: true,
      siteId: true,
      shiftStart: true,
      shiftEnd: true,
      user: { select: { name: true } },
      equipment: { select: { name: true } },
      site: { select: { name: true } },
      piles: { select: { count: true, pileGrade: { select: { lengthMm: true } } } },
      drillings: { select: { meters: true } },
      downtimes: { select: { duration: true } },
    },
  });
  return reports.map((r) => ({
    date: r.date,
    userId: r.userId,
    userName: r.user?.name || '—',
    equipmentId: r.equipmentId,
    equipmentName: r.equipment?.name || null,
    siteId: r.siteId,
    siteName: r.site?.name || '—',
    shiftMinutes: shiftMinutesOf(r.shiftStart, r.shiftEnd),
    piles: r.piles.reduce((s, p) => s + p.count, 0),
    meters: r.piles.reduce((s, p) => s + p.count * pileLengthMeters({ gradeLengthMm: p.pileGrade?.lengthMm }), 0),
    drilling: r.drillings.reduce((s, d) => s + d.meters, 0),
    downtime: r.downtimes.reduce((s, d) => s + d.duration, 0), // HOURS (domain invariant)
  }));
}

interface Totals { piles: number; meters: number; drilling: number; downtimePct: number | null }

function totalsOf(rows: ReportRow[]): Totals {
  let piles = 0; let meters = 0; let drilling = 0;
  let shiftMin = 0; let downtimeInShift = 0;
  for (const r of rows) {
    piles += r.piles; meters += r.meters; drilling += r.drilling;
    if (r.shiftMinutes != null && r.shiftMinutes > 0) {
      shiftMin += r.shiftMinutes;
      downtimeInShift += r.downtime;
    }
  }
  // Same formula as the OperatorPerformance projection: hours×60 ÷ minutes.
  const downtimePct = shiftMin > 0 ? Math.round(((downtimeInShift * 60) / shiftMin) * 1000) / 10 : null;
  return { piles, meters: Math.round(meters * 10) / 10, drilling: Math.round(drilling * 10) / 10, downtimePct };
}

function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null; // no baseline — show nothing rather than a fake %
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'analytics.read');
  if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
  const tenantId = user.tenantId;

  const from = request.nextUrl.searchParams.get('dateFrom');
  const to = request.nextUrl.searchParams.get('dateTo');
  const siteParam = request.nextUrl.searchParams.get('siteId');
  const siteId = siteParam && siteParam !== 'all' ? siteParam : null;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'dateFrom и dateTo обязательны (YYYY-MM-DD)' }, { status: 400 });
  }

  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  const prevTo = isoDay(new Date(fromDate.getTime() - DAY_MS));
  const prevFrom = isoDay(new Date(fromDate.getTime() - days * DAY_MS));

  const [rows, prevRows, equipment] = await Promise.all([
    loadPeriod(tenantId, from, to, siteId),
    loadPeriod(tenantId, prevFrom, prevTo, siteId),
    db.equipment.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
  ]);

  const current = totalsOf(rows);
  const previous = totalsOf(prevRows);

  // Daily pile-meters series (every day of the period, zeros included).
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.meters);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = isoDay(new Date(fromDate.getTime() + i * DAY_MS));
    return { date, meters: Math.round((byDay.get(date) ?? 0) * 10) / 10 };
  });

  // Equipment usage: distinct report-days per rig ÷ period days.
  const daysByEquipment = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.equipmentId) continue;
    const set = daysByEquipment.get(r.equipmentId) ?? new Set<string>();
    set.add(r.date);
    daysByEquipment.set(r.equipmentId, set);
  }
  const equipmentUsage = equipment
    .map((e) => {
      const activeDays = daysByEquipment.get(e.id)?.size ?? 0;
      return { id: e.id, name: e.name, activeDays, usagePct: Math.round((activeDays / days) * 100) };
    })
    .sort((a, b) => b.usagePct - a.usagePct);

  // Site rating by meters.
  const bySite = new Map<string, { id: string; name: string; meters: number; piles: number }>();
  for (const r of rows) {
    const cur = bySite.get(r.siteId) ?? { id: r.siteId, name: r.siteName, meters: 0, piles: 0 };
    cur.meters += r.meters; cur.piles += r.piles;
    bySite.set(r.siteId, cur);
  }
  const siteRating = [...bySite.values()]
    .map((s) => ({ ...s, meters: Math.round(s.meters * 10) / 10 }))
    .sort((a, b) => b.meters - a.meters);

  // Per-operator table.
  const byOperator = new Map<string, {
    userId: string; userName: string; piles: number; meters: number; drilling: number;
    reports: number; shiftMin: number; downtimeInShift: number; hasShift: boolean;
  }>();
  for (const r of rows) {
    const cur = byOperator.get(r.userId) ?? {
      userId: r.userId, userName: r.userName, piles: 0, meters: 0, drilling: 0,
      reports: 0, shiftMin: 0, downtimeInShift: 0, hasShift: false,
    };
    cur.piles += r.piles; cur.meters += r.meters; cur.drilling += r.drilling; cur.reports += 1;
    if (r.shiftMinutes != null && r.shiftMinutes > 0) {
      cur.shiftMin += r.shiftMinutes; cur.downtimeInShift += r.downtime; cur.hasShift = true;
    }
    byOperator.set(r.userId, cur);
  }
  const operators = [...byOperator.values()]
    .map((o) => ({
      userId: o.userId,
      userName: o.userName,
      workedHours: o.hasShift ? Math.round((o.shiftMin / 60) * 10) / 10 : null,
      meters: Math.round(o.meters * 10) / 10,
      piles: o.piles,
      drilling: Math.round(o.drilling * 10) / 10,
      downtimePct: o.shiftMin > 0 ? Math.round(((o.downtimeInShift * 60) / o.shiftMin) * 1000) / 10 : null,
      reports: o.reports,
    }))
    .sort((a, b) => b.meters - a.meters || b.piles - a.piles);

  return NextResponse.json({
    period: { from, to, days },
    kpi: {
      meters: { value: current.meters, deltaPct: deltaPct(current.meters, previous.meters) },
      piles: { value: current.piles, deltaPct: deltaPct(current.piles, previous.piles) },
      drilling: { value: current.drilling, deltaPct: deltaPct(current.drilling, previous.drilling) },
      downtimePct: {
        value: current.downtimePct,
        deltaPp: current.downtimePct != null && previous.downtimePct != null
          ? Math.round((current.downtimePct - previous.downtimePct) * 10) / 10
          : null,
      },
    },
    daily,
    equipmentUsage,
    siteRating,
    operators,
  });
}, { domain: 'admin-analytics' });
