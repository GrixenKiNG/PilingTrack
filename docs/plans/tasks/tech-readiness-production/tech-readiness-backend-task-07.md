# Tech Readiness Backend Task 07 — Transactional source commands and mechanic workload

**Work-plan coverage:** TR-600, TR-601. **Goal:** make every snapshot trigger source transaction-safe and expose bounded mechanic workload.

## Target files

- Edit `src/modules/inspections/application/commands/inspection-commands.ts`, `src/modules/equipment/application/commands/meter-reading.ts`, and the exact files exporting `equipment-maintenance` and `maintenance-plan`.
- Edit only their existing API routes identified by GitNexus.
- Create `src/modules/readiness/application/maintenance/workload-query.ts`, `src/modules/readiness/infrastructure/maintenance/workload-repository.ts`, `src/app/api/readiness/maintenance/workload/route.ts`.
- Add focused legacy-command, integration, workload and contract tests.

## Prerequisites and steps

1. Backend Task 06.
2. Make reused commands accept transaction client and append audit/outbox in that same transaction without legacy semantic change.
3. Add feature-gated readiness side effects for inspection, defect, meter, maintenance and plan changes.
4. Build tenant-scoped grouped workload by mechanic/state/due condition using bounded batch queries.

## Tests and validation

- Add existing-command regression and source/audit/outbox rollback tests for every trigger; role/tenant/query-count/workload-state tests.
- Run focused unit/integration/contract; typecheck; `detect_changes` flow review; workload query-count probe.

## GitNexus gate

- Upstream `impact` every named existing command and route symbol individually, plus maintenance query/service and assignee route. Stop on HIGH/CRITICAL before edits.
- `detect_changes(scope:"all")`; only listed source command/route adapters and new workload paths/tests.

## Acceptance, rollback, exclusions

- Acceptance: no source commits without audit/outbox when gate on; all trigger sources converge; workload is server projection with no N+1/load-all.
- Rollback: disable readiness side effects/workload panel; preserve legacy command behavior and queued events.
- Forbidden: broad refactor of legacy modules, partial transaction, static counters, unrelated inspection/equipment/maintenance UI.
