/**
 * Ops Shell — reusable presentational skeleton for operational module screens
 * (sites, crews, users, inspections). Extracted from the proven admin-reports
 * layout so each module becomes "configure columns + KPIs + risks", not a fresh
 * build. No data fetching here — pass data in, render out.
 *
 * Skeleton mapping:
 *   OpsPage      → screen layout (main + sticky detail panel)
 *   OpsHeader    → title + count + purpose + actions
 *   OpsKpiBar    → KPI strip
 *   OpsFilterBar → quick-filter pills + slot for selects/date range
 *   OpsTable     → dense journal table (generic columns)
 *   OpsDetailPanel / OpsFact / OpsHistoryList → right details + history
 *   OpsRiskBadge / resolveRisk → risk statuses (not decorative)
 */
export { OpsPage, OpsHeader } from './ops-page';
export { OpsKpiBar } from './ops-kpi-bar';
export { OpsFilterBar } from './ops-filter-bar';
export { OpsTable, OpsTableEmpty } from './ops-table';
export {
  OpsDetailPanel,
  OpsDetailEmpty,
  OpsFact,
  OpsHistoryList,
  type OpsHistoryEntry,
} from './ops-detail-panel';
export { OpsRiskBadge, resolveRisk } from './ops-risk-badge';
export { useEntityHistory, type EntityHistoryState } from './use-entity-history';
export type { OpsTone, RiskLevel, OpsKpiItem, OpsQuickFilter, OpsColumn } from './types';
