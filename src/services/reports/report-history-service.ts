import { db } from '@/lib/db';
import { requireTenantId } from '@/lib/tenant-scope';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
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

/**
 * История отчёта с подстановкой имён вместо идентификаторов.
 *
 * Организация и самого отчёта, и смотрящего сверяются до чтения истории:
 * `ensureTenantAccess` отдаёт 403, если у сессии нет организации, и 404, если
 * отчёта нет или он принадлежит другой организации. Без этой сверки право
 * `reports.read_all` позволяло угадать id чужого отчёта и прочитать его
 * историю с подписями — защищал только RLS базы.
 *
 * Имена при этом разрешаются в организации самого отчёта, а не смотрящего: он
 * уже доказал, что смотрит свой отчёт, и карты строятся по его организации —
 * платформенный администратор увидит подписи, а не голые идентификаторы, и ни
 * одной чужой строки в карту не попадёт.
 *
 * Раньше все шесть карт грузились целиком, без сужения: `findMany` по
 * справочникам, объектам, пользователям и установкам возвращал строки всех
 * организаций сразу. Это единственное место, где список пользователей всей
 * системы оказывался в памяти при открытии одного отчёта.
 */
export async function getReportHistory(
  reportId: string,
  user: { id: string; role: string; tenantId?: string | null },
): Promise<ReportHistory> {
  const report = await db.report.findUnique({
    where: { reportId },
    select: { tenantId: true },
  });
  await ensureTenantAccess(user, report?.tenantId, 'Report');
  const scope = { tenantId: requireTenantId(report?.tenantId) };

  const [auditRows, versionRows, pileGrades, drillingTypes, downtimeReasons, sites, users, equipment] = await Promise.all([
    db.reportAudit.findMany({ where: { reportId }, orderBy: { createdAt: 'desc' } }),
    db.reportVersion.findMany({ where: { reportId }, orderBy: { version: 'desc' }, select: { version: true, actorId: true, createdAt: true } }),
    db.pileGrade.findMany({ where: scope, select: { id: true, name: true } }),
    db.drillingType.findMany({ where: scope, select: { id: true, name: true } }),
    db.downtimeReason.findMany({ where: scope, select: { id: true, name: true } }),
    db.site.findMany({ where: scope, select: { id: true, name: true } }),
    db.user.findMany({ where: scope, select: { id: true, name: true } }),
    db.equipment.findMany({ where: scope, select: { id: true, name: true } }),
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
