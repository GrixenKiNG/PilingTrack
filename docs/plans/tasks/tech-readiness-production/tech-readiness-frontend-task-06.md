# Tech Readiness Frontend Task 06 — Maintenance and workload

**Work-plan coverage:** TR-602. **Goal:** deliver real maintenance, inspection, meter, plan and mechanic workload sections.

## Target files

- Create `src/components/piling/to/readiness/maintenance/{maintenance-route,maintenance-section-nav,maintenance-queries,mechanic-workload,maintenance-controller}.tsx`.
- Create feature tests.
- Edit adapters around existing `src/components/piling/to/maintenance-plans-panel.tsx` and exact meter/maintenance panels located by GitNexus; edit API contracts/query keys.

## Prerequisites and steps

1. Backend Task 07.
2. Bind inspections, defects, meters, maintenance, plans and workload to real endpoints/actions.
3. Use the update API wherever editing is shown; express role/state pending/success/convergence honestly.

## Tests and validation

- Add role/state/empty/error/pending, update, convergence and viewport tests; Playwright MECHANIC and acting ADMIN smoke.
- Run focused component and source-integration tests; typecheck; HTTP browser 1440/390.

## GitNexus gate

- Upstream `impact`: `MaintenancePlansPanel`, `MeterReadingsPanel`, legacy `MaintenanceScreen`, each adapter integration symbol. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; listed maintenance frontend/API tests only.

## Acceptance, rollback, exclusions

- Acceptance: MECHANIC/acting ADMIN allowed actions work; dispatcher read-only; green inspection includes actual completion date/executor; readiness converges without reload.
- Rollback: maintenance tab flag returns existing read-only panel.
- Forbidden: configured-component-as-completed status, local workload counters, fake edit, unrelated maintenance admin/shared UI.
