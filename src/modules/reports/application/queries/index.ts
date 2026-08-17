export {
  getEditableReport,
  getReportsByPeriod,
  listReportsForReview,
  listRecentReportsForDashboard,
  listReportsForUserScope,
  exportReportsCsv,
  getDashboardStats,
  reportDetailInclude,
} from './report-query.service';
export type { RecentReportRow } from './report-query.service';

// Здесь до 17.08.2026 стояли двенадцать реэкспортов из cqrs-query.service.ts:
// getReportStats, getSiteDailyStats, getSiteDashboard, getOperatorPerformance,
// getSiteOperatorPerformance, getOperatorLeaderboard, getDowntimeSummary,
// getDowntimeTrend, getTopDowntimeReasons, getWeeklyTrend, getWeeklyTrends,
// getFullDashboard. Файл удалён: 278 строк, ни одного вызова во всём
// репозитории и ни одного фильтра по tenantId. Опасен он был именно тем, что
// торчал через эту публичную границу — новый код, взявший отсюда «готовый
// запрос», молча читал бы данные всех организаций.
//
// Живые витрины считают по-другому: аналитика — живьём из отчётов
// (/api/admin/analytics/overview), недельные тренды — из SiteWeeklyTrend
// (/api/admin/analytics/site-weekly-trend), обе с обязательным tenantId.
