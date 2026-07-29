# Tech Readiness Frontend Task 05 — Center, equipment and trend

**Work-plan coverage:** frontend half of TR-503. **Goal:** render server current/history/trend/evidence/workflow models across center and equipment tabs.

## Target files

- Create `src/components/piling/to/readiness/center/{readiness-center-route,snapshot-header,readiness-score,blockers-warnings,evidence-grid,active-workflow-panel,snapshot-history}.tsx`.
- Create `src/components/piling/to/readiness/equipment/{equipment-route,equipment-list,equipment-detail-route,equipment-queries}.tsx`.
- Create `src/components/piling/to/readiness/reports/readiness-trend.tsx`.
- Add tests in each feature folder; edit `tech-readiness-module.tsx` and API contracts/query keys.

## Prerequisites and steps

1. Backend Task 06.
2. Bind current/history/trend/evidence and active workflow queries; implement stale/convergence states.
3. Replace legacy tabs only after per-tab parity; remove production imports of `deriveEquipmentReadiness`.

## Tests and validation

- Add loading/error/empty/current/history convergence, provenance, role action and 1440/390 component tests; activate current-snapshot E2E assertion.
- Run focused Vitest; typecheck; Playwright center/equipment 1440/1280/1024/390; verify no client recompute.

## GitNexus gate

- Upstream `impact`: `deriveEquipmentReadiness`, `ReadinessCentre`, `FleetScreen`, `TechReadinessModule`. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; listed center/equipment/trend/API/tests only.

## Acceptance, rollback, exclusions

- Acceptance: source→snapshot→current/history/trend→UI demonstrated; every visible score/evidence is server-backed; stale banner converges within bounded refetch.
- Rollback: per-tab snapshot read flag returns legacy view.
- Forbidden: local score derivation, mocks, browser audit CSV, unrelated equipment/admin pages.
