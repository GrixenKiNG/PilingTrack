import { db } from '@/lib/db';
import {
  actionLabel, humanizeDiff,
  type NameLookups, type ReportHistory, type ReportHistoryEvent, type ReportHistoryVersion,
} from './report-history';

// Re-export the pure helpers/types so server-side consumers (route, tests) can
// keep importing from this module. Client code must import from './report-history'
// directly to avoid pulling Prisma/pg into the browser bundle.
export * from './report-history';

function toMap(rows: Array<{ id: string; name: string | null }>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) if (r.name) m[r.id] = r.name;
  return m;
}

export async function getReportHistory(reportId: string): Promise<ReportHistory> {
  const [auditRows, versionRows, pileGrades, drillingTypes, downtimeReasons, sites, users, equipment] = await Promise.all([
    db.reportAudit.findMany({ where: { reportId }, orderBy: { createdAt: 'desc' } }),
    db.reportVersion.findMany({ where: { reportId }, orderBy: { version: 'desc' }, select: { version: true, actorId: true, createdAt: true } }),
    db.pileGrade.findMany({ select: { id: true, name: true } }),
    db.drillingType.findMany({ select: { id: true, name: true } }),
    db.downtimeReason.findMany({ select: { id: true, name: true } }),
    db.site.findMany({ select: { id: true, name: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
    db.equipment.findMany({ select: { id: true, name: true } }),
  ]);

  const lookups: NameLookups = {
    pileGrade: toMap(pileGrades), drillingType: toMap(drillingTypes), downtimeReason: toMap(downtimeReasons),
    site: toMap(sites), user: toMap(users), equipment: toMap(equipment),
  };

  const events: ReportHistoryEvent[] = auditRows.map((row) => ({
    id: row.id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    actorName: row.actorName ?? null,
    actorRole: row.actorRole ?? null,
    createdAt: row.createdAt.toISOString(),
    changes: row.diff ? humanizeDiff(row.diff as Record<string, unknown>, lookups) : [],
  }));

  const versions: ReportHistoryVersion[] = versionRows.map((v) => ({
    version: v.version, actorId: v.actorId, createdAt: v.createdAt.toISOString(),
  }));

  return { events, versions };
}
